//! Scripts on threads of their own: a [`Worker`] runs one script in its own runtime, so the app
//! goes on while the script works, waits for a dialog or loops, and can stop it. The app sends
//! [`Request`]s with the document as it is, and the worker answers each one with the [`Reply`]s
//! that say what the script changed, then [`Reply::Done`].
//!
//! The worker reads the document from the snapshot it got; its changes go back as
//! `document.patch` params, which the app applies and answers with [`Request::Applied`] before
//! anything else. On the web there are no threads: the worker runs each request as it is sent.

use std::collections::BTreeSet;
use std::sync::Arc;
use std::time::Duration;

use serde_json::Value as Json;
use vectorcraft_doc::{Document, NodeId, Selection};

use crate::overlay::{Overlay, View};
use crate::{Engine, Error, Key, Modifiers, MouseEvent, PaletteEvent, Patch, PlatformEngine, Runtime, Scope, Setup};

/// What the app asks a worker to do.
pub enum Request {
    /// Make the document `uid` the active one, and catch up with it, its active artboard and the
    /// style new art takes in the app (as [`crate::host::current_style`] makes it), then do `work`
    /// at `now`, in milliseconds since the script started, and draw the overlay of its draw
    /// handlers for the document's `view`, when the app shows one.
    Run { uid: u64, doc: Arc<Document>, selection: Selection, artboard: usize, style: Json, now: f64, view: Option<View>, work: Work },
    /// The answer to [`Reply::Changes`]: `document.patch`'s result, and the document after it.
    /// `behind` when the document had changed in other ways since the patch's base.
    Applied { result: Json, doc: Arc<Document>, selection: Selection, behind: bool },
    /// The document `uid` closed: its project goes.
    Closed(u64),
    /// The answer to [`Reply::Ask`].
    Answer(Json),
}

/// A pointer event for a tool, at a point in document coordinates, and its time in seconds.
pub type Pointer = (MouseEvent, (f64, f64), Modifiers, f64);

/// A script's work.
pub enum Work {
    /// Runs PaperScript.
    Execute(String),
    /// Runs the timers due: its `onFrame` and intervals.
    Frame,
    /// Pointer events for the script's tool: a frame's, in one go.
    Mouse(Vec<Pointer>),
    /// A key going down (`true`) or up for the script's tool: its name as Paper.js has it, and the
    /// character it types.
    Key(bool, String, Option<String>, Modifiers),
    /// A key typed on the canvas, for the script's `document`.
    DocumentKey(Key),
    /// What the user did in one of the script's palettes.
    Palette(u64, PaletteEvent),
    /// The user picked the script's tool (`true`), or another one.
    Activate(bool),
    /// Calls the script's handler of that name, one of [`crate::HANDLERS`], when it has one.
    Handler(&'static str),
    /// Nothing but the document the work comes with, the document `uid`: the script catches up
    /// with it, and its project becomes the active one, as the user switches documents.
    Switch(u64),
    /// Nothing but the overlay of the draw handlers, for the view the work comes with, which
    /// panned or zoomed since they last drew.
    Draw,
    /// The user's answer to the oldest of the script's dialogs, on the web, where the script didn't
    /// wait for it ([`crate::Runtime::answer`]).
    #[cfg(target_arch = "wasm32")]
    Answer(Json),
    /// What the user picked in the oldest of the script's file dialogs, on the web
    /// ([`crate::Runtime::picked`]).
    #[cfg(target_arch = "wasm32")]
    Picked(Option<crate::Picked>),
}

/// What a worker tells the app.
pub enum Reply {
    /// The script shows a dialog (`Dialog.alert`, `confirm`, `prompt`) and waits for the user's
    /// answer ([`Request::Answer`]); the question as [`crate::Runtime::set_ask`] has it. On the
    /// web, the script goes on, and the answer comes as [`Work::Answer`] or [`Work::Picked`].
    Ask(Json),
    /// What the script changed in the document `uid`: a patch of `base`, the document it read (the
    /// app answers with [`Request::Applied`]), and the objects selected in its project before and
    /// after. `effects` when it's what the script's effects drew of objects whose input changed,
    /// which belongs to the newest undo step, the edit that changed it
    /// ([`crate::Runtime::effect_outputs`]).
    Changes { uid: u64, patch: Option<Json>, base: Arc<Document>, before: BTreeSet<NodeId>, selected: BTreeSet<NodeId>, effects: bool },
    /// The script's answer to a [`Work::DocumentKey`], before its `Done`: whether a listener
    /// prevented the key's default (`false` when one threw).
    Key { prevented: bool },
    /// The work is done: what the script printed, its error if it threw, when it next needs a
    /// [`Work::Frame`] ([`crate::Runtime::next_turn`]), whether it defines effects, which draw in
    /// a frame once the document changed, whether it made a tool, whether that tool handles keys,
    /// the palettes that are new or changed (as [`crate::Runtime::take_palettes`] has them),
    /// whether it has palettes open, whether it listens for keys on its `document` or `window`,
    /// whether it set `script.keepAlive`, and what its draw handlers drew, if anything.
    Done {
        output: Vec<String>,
        error: Option<String>,
        wake: Option<f64>,
        effects: bool,
        tool: bool,
        keys: bool,
        palettes: Vec<Json>,
        open: bool,
        listening: bool,
        keep_alive: bool,
        overlay: Option<Overlay>,
    },
}

/// One script's runtime, and the patches waiting for their ids, in the order they went.
struct Script<E: Engine> {
    runtime: Runtime<E>,
    scope: Scope<E::Handle>,
    pending: std::collections::VecDeque<Patch<E::Handle>>,
    /// The app's style, as last set as each document's project's current style: set again only
    /// when the app's changes, so a style the script sets itself stays until then.
    styles: Vec<(u64, Json)>,
    /// What its draw handlers drew after its last work, for its `Done`.
    overlay: Option<Overlay>,
}

impl<E: Engine> Script<E> {
    /// A runtime whose view has the given size, for the script `setup` describes.
    fn new(size: (f64, f64), setup: &Setup) -> Result<Self, Error> {
        let mut runtime = Runtime::<E>::new()?;
        runtime.set_script(setup)?;
        let scope = runtime.create_scope(size.0, size.1)?;
        Ok(Self { runtime, scope, pending: Default::default(), styles: Vec::new(), overlay: None })
    }

    fn handle(&mut self, request: Request) -> Vec<Reply> {
        match request {
            Request::Run { uid, doc, selection, artboard, style, now, view, work } => self.run(uid, doc, selection, artboard, style, now, view, work),
            // An answer no dialog waits for.
            Request::Answer(_) => Vec::new(),
            Request::Applied { result, doc, selection, behind } => match self.pending.pop_front() {
                Some(patch) => match self.runtime.apply_ids(patch, &result, doc, selection, behind) {
                    Ok(()) => Vec::new(),
                    Err(e) => vec![self.done(Some(e.to_string()))],
                },
                None => Vec::new(),
            },
            Request::Closed(uid) => {
                self.styles.retain(|(other, _)| *other != uid);
                match self.runtime.unbind(uid) {
                    Ok(()) => Vec::new(),
                    Err(e) => vec![self.done(Some(e.to_string()))],
                }
            }
        }
    }

    /// Does `work` with the document `uid` active, and replies what it changed, even when it
    /// threw, as a browser keeps what a script did before an error.
    #[allow(clippy::too_many_arguments)]
    fn run(
        &mut self,
        uid: u64,
        doc: Arc<Document>,
        selection: Selection,
        artboard: usize,
        style: Json,
        now: f64,
        view: Option<View>,
        work: Work,
    ) -> Vec<Reply> {
        self.runtime.set_now(now);
        if let Err(e) = self.runtime.bind(&self.scope, uid, doc, selection) {
            return vec![self.done(Some(e.to_string()))];
        }
        self.runtime.set_artboard(artboard);
        if !self.styles.iter().any(|(other, last)| *other == uid && *last == style) {
            if let Err(e) = self.runtime.set_current_style(&self.scope, &style) {
                return vec![self.done(Some(e.to_string()))];
            }
            self.styles.retain(|(other, _)| *other != uid);
            self.styles.push((uid, style));
        }
        let before = match self.runtime.selected_ids(&self.scope) {
            Ok(before) => before,
            Err(e) => return vec![self.done(Some(e.to_string()))],
        };
        let mut prevented = None;
        let result = match work {
            Work::Execute(source) => self.runtime.execute(&self.scope, &source),
            Work::Frame => self.runtime.run_timers(now),
            Work::Mouse(events) => events
                .into_iter()
                .try_for_each(|(event, point, modifiers, time)| self.runtime.mouse_event(&self.scope, event, point, modifiers, time)),
            Work::Key(down, key, character, modifiers) => self.runtime.key_event(&self.scope, down, &key, character.as_deref(), modifiers),
            Work::DocumentKey(key) => {
                let result = self.runtime.document_key(&key);
                prevented = Some(result.as_ref().is_ok_and(|prevented| *prevented));
                result.map(|_| ())
            }
            Work::Palette(id, event) => self.runtime.palette_event(id, event),
            Work::Activate(active) => self.runtime.activate_tool(&self.scope, active),
            Work::Handler(name) => self.runtime.call_handler(name).map(|_| ()),
            Work::Switch(_) | Work::Draw => Ok(()),
            #[cfg(target_arch = "wasm32")]
            Work::Answer(answer) => self.runtime.answer(&answer),
            #[cfg(target_arch = "wasm32")]
            Work::Picked(picked) => self.runtime.picked(picked),
        };
        let mut replies = Vec::new();
        #[cfg(target_arch = "wasm32")]
        replies.extend(self.runtime.take_question().map(Reply::Ask));
        // The script's effects draw on a turn it changed nothing itself, from the document as it is:
        let changes = match self.changes(uid, before.clone()) {
            Ok(changes) if changes.is_empty() => self.effect_changes(uid, before).map(Vec::from_iter),
            changes => changes,
        };
        let changes = changes.map(|changes| replies.extend(changes));
        // The handlers draw the project as the script left it, its changes included:
        let drawn = view.map_or(Ok(None), |view| self.runtime.draw_overlay(view)).map(|overlay| self.overlay = overlay);
        replies.extend(prevented.map(|prevented| Reply::Key { prevented }));
        replies.push(self.done(result.and(changes).and(drawn).err().map(|e| e.to_string())));
        replies
    }

    /// What the script changed in each document, the active one's (`uid`) first, with what it
    /// selected there since `before`.
    fn changes(&mut self, uid: u64, before: BTreeSet<NodeId>) -> Result<Vec<Reply>, Error> {
        let patches = self.runtime.take_patches()?;
        let selected = self.runtime.selected_ids(&self.scope)?;
        let mut replies = Vec::with_capacity(patches.len() + 1);
        // A selection the script changed in a document it changed nothing else in:
        if selected != before && patches.first().is_none_or(|p| p.uid != uid) {
            let base = self.runtime.document().ok_or_else(|| Error::Script("no document is bound".into()))?;
            replies.push(Reply::Changes { uid, patch: None, base, before: before.clone(), selected: selected.clone(), effects: false });
        }
        for patch in patches {
            // Only the active document's selection is the script's to change:
            let (before, selected) = if patch.uid == uid { (before.clone(), selected.clone()) } else { Default::default() };
            let (params, base) = (Some(patch.params.clone()), patch.base.clone());
            replies.push(Reply::Changes { uid: patch.uid, patch: params, base, before, selected, effects: false });
            self.pending.push_back(patch);
        }
        Ok(replies)
    }

    /// What the script's effects drew of the objects whose input changed in the document `uid`, if
    /// anything.
    fn effect_changes(&mut self, uid: u64, selected: BTreeSet<NodeId>) -> Result<Option<Reply>, Error> {
        let Some(patch) = self.runtime.effect_outputs(&self.scope)? else {
            return Ok(None);
        };
        let base = self.runtime.document().ok_or_else(|| Error::Script("no document is bound".into()))?;
        Ok(Some(Reply::Changes { uid, patch: Some(patch), base, before: selected.clone(), selected, effects: true }))
    }

    fn done(&mut self, error: Option<String>) -> Reply {
        let tool = self.runtime.has_tool(&self.scope).unwrap_or(false);
        let keys = tool && self.runtime.has_key_handlers(&self.scope).unwrap_or(false);
        let (palettes, error) = match self.runtime.take_palettes() {
            Ok(palettes) => (palettes, error),
            Err(e) => (Vec::new(), error.or(Some(e.to_string()))),
        };
        let (wake, effects, open) = (self.runtime.next_turn(), self.runtime.has_effects(), self.runtime.has_palettes());
        let listening = self.runtime.has_key_listeners().unwrap_or(false);
        let keep_alive = self.runtime.keep_alive().unwrap_or(false);
        let error = match self.runtime.keep_preferences() {
            Ok(()) => error,
            Err(e) => error.or(Some(e.to_string())),
        };
        let overlay = self.overlay.take();
        Reply::Done { output: self.runtime.take_output(), error, wake, effects, tool, keys, palettes, open, listening, keep_alive, overlay }
    }
}

/// A script running on a thread of its own.
#[cfg(not(target_arch = "wasm32"))]
pub struct Worker {
    requests: std::sync::mpsc::Sender<Request>,
    replies: std::sync::mpsc::Receiver<Reply>,
    /// Stops the script mid-run, or as its runtime starts, where the engine can.
    interrupt: Arc<std::sync::Mutex<crate::Stop>>,
    /// Set when the worker is dropped: the requests still queued are left.
    stopped: Arc<std::sync::atomic::AtomicBool>,
}

#[cfg(not(target_arch = "wasm32"))]
impl Worker {
    /// Starts a script's thread, with a runtime whose view has the given size, for the script
    /// `setup` describes.
    pub fn spawn(size: (f64, f64), setup: Setup) -> Result<Self, Error> {
        let (requests, inbox) = std::sync::mpsc::channel::<Request>();
        let (outbox, replies) = std::sync::mpsc::channel();
        let interrupt = crate::Stop::new();
        let stopped = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let (shared, is_stopped) = (interrupt.clone(), stopped.clone());
        let is_stopped = move || is_stopped.load(std::sync::atomic::Ordering::SeqCst);
        std::thread::Builder::new()
            .name("scriptographer script".into())
            .spawn(move || {
                let inbox = std::rc::Rc::new(inbox);
                let mut script = match Script::<PlatformEngine>::new(size, &setup) {
                    Ok(script) => script,
                    Err(e) => {
                        // The app may have stopped the script already; then nobody listens.
                        let _ = outbox.send(Reply::Done {
                            output: Vec::new(),
                            error: Some(e.to_string()),
                            wake: None,
                            effects: false,
                            tool: false,
                            keys: false,
                            palettes: Vec::new(),
                            open: false,
                            listening: false,
                            keep_alive: false,
                            overlay: None,
                        });
                        return;
                    }
                };
                crate::Stop::started(&shared, script.runtime.interrupt());
                // A dialog asks the app, and waits for its answer; what else the app sends
                // meanwhile (a document that closed) waits for the script's work to end. Stopped,
                // the script throws.
                let deferred = std::rc::Rc::new(std::cell::RefCell::new(std::collections::VecDeque::new()));
                let (asking, answers, waiting) = (outbox.clone(), inbox.clone(), deferred.clone());
                script.runtime.set_ask(Box::new(move |question| {
                    asking.send(Reply::Ask(question)).map_err(|_| Error::Script("stopped".into()))?;
                    loop {
                        match answers.recv() {
                            Ok(Request::Answer(answer)) => return Ok(answer),
                            Ok(request) => waiting.borrow_mut().push_back(request),
                            Err(_) => return Err(Error::Script("stopped".into())),
                        }
                    }
                }));
                // Until the app drops the worker.
                loop {
                    let next = deferred.borrow_mut().pop_front();
                    let Some(request) = next.or_else(|| inbox.recv().ok()) else {
                        return;
                    };
                    if is_stopped() {
                        return;
                    }
                    for reply in script.handle(request) {
                        if outbox.send(reply).is_err() {
                            return;
                        }
                    }
                }
            })
            .map_err(|e| Error::Script(format!("can't start the script's thread: {e}")))?;
        Ok(Self { requests, replies, interrupt, stopped })
    }

    pub fn send(&self, request: Request) {
        // Fails only when the thread ended, which its last reply said.
        let _ = self.requests.send(request);
    }

    /// The next reply, waiting for it at most `wait`.
    pub fn recv(&self, wait: Duration) -> Option<Reply> {
        self.replies.recv_timeout(wait).ok()
    }

    /// Stops what the script runs now, where the engine can (V8): it throws, and its `Done` says
    /// so. Boa scripts run on until they return.
    pub fn interrupt(&self) {
        crate::Stop::stop(&self.interrupt);
    }
}

#[cfg(not(target_arch = "wasm32"))]
impl Worker {
    /// Whether the script changed a project outside its work: never here, where its Promise
    /// continuations run within its work (the web's run after it).
    pub fn has_changes(&self) -> bool {
        false
    }
}

/// Stops the script: its thread ends once the script returns.
#[cfg(not(target_arch = "wasm32"))]
impl Drop for Worker {
    fn drop(&mut self) {
        self.stopped.store(true, std::sync::atomic::Ordering::SeqCst);
        self.interrupt();
    }
}

/// A script, run on the app's thread: each request runs as it is sent.
#[cfg(target_arch = "wasm32")]
pub struct Worker {
    script: std::cell::RefCell<Script<PlatformEngine>>,
    replies: std::cell::RefCell<std::collections::VecDeque<Reply>>,
}

#[cfg(target_arch = "wasm32")]
impl Worker {
    pub fn spawn(size: (f64, f64), setup: Setup) -> Result<Self, Error> {
        let script = Script::<PlatformEngine>::new(size, &setup)?;
        Ok(Self { script: std::cell::RefCell::new(script), replies: Default::default() })
    }

    pub fn send(&self, request: Request) {
        // Requests come from the app, one at a time: the borrows are free.
        if let (Ok(mut script), Ok(mut replies)) = (self.script.try_borrow_mut(), self.replies.try_borrow_mut()) {
            replies.extend(script.handle(request));
        }
    }

    pub fn recv(&self, _wait: Duration) -> Option<Reply> {
        self.replies.try_borrow_mut().ok()?.pop_front()
    }

    /// Whether the script changed a project outside its work, in a Promise continuation, which
    /// the browser runs once the call into the script has returned: work then collects it.
    pub fn has_changes(&self) -> bool {
        self.script.try_borrow_mut().is_ok_and(|mut script| script.runtime.has_changes().unwrap_or(false))
    }
}
