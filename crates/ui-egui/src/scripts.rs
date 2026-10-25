//! Scriptographer: PaperScript files (`.js`) run on the active document. A script sees the document
//! as a Paper.js project, and what it changes comes back as one undo step. A script with `onFrame`
//! or an interval keeps running, driven by the app's frames, until it stops or Stop Running
//! Scripts stops it; the whole run is one undo step while nothing else edits the document in
//! between. Each script runs on a thread of its own (`vectorcraft_scriptographer::worker`): the app
//! sends it its work with the document as it is, waits a moment for what it changed, and goes on
//! when it takes longer. Edits made in the meantime win over the script's. A script works in every
//! open document, each one a project of its own and the active one its `project`: it goes on when
//! another document is active, and when one of its documents closes. One tool script at a time is
//! the Scriptographer Tool. A script's dialogs (`Dialog.prompt`…) show as app dialogs while it waits, its
//! palettes (`new Palette`) as floating panels while it runs.
//!
//! `ui.runScript {path?}` runs a script (without a path it asks for the file),
//! `ui.stopScripts` stops the running ones and `ui.evaluateScript {code}` runs a line in the
//! console's own project, which lives as long as the app. Everything scripts print and every error
//! goes to the log the Scriptographer Console panel shows; the last line also shows in the status bar.
//! The scripts folders (`UiState::scriptographer_folders`) are what the Scriptographer panel lists:
//! the Examples, sealed, and on the first run "My Scripts" ([`set_up_script_folders`]). A script's
//! view is the first artboard, so `view.bounds` is its size.

#[cfg(target_arch = "wasm32")]
use std::cell::RefCell;
use std::collections::{BTreeSet, VecDeque};
use std::path::{Path, PathBuf};
#[cfg(target_arch = "wasm32")]
use std::rc::Rc;
use std::sync::Arc;
use std::time::Duration;

use serde_json::{Value, json};
use vectorcraft_doc::{Document, NodeId};
use vectorcraft_scriptographer::worker::{Pointer, Reply, Request, Work, Worker};
use vectorcraft_scriptographer::{Key, Modifiers, MouseEvent, PaletteEvent, Setup};
use vectorcraft_tools::Cursor;
use web_time::Instant;

use crate::state::ScriptFolder;
use crate::{FilePick, VectorcraftApp};

/// Script files.
const EXTS: &[&str] = &["js", "pjs"];

/// How long the app waits for a script it runs before it goes on, and the script with it.
const RUN_WAIT: Duration = Duration::from_secs(2);

/// How long a frame waits for the scripts' replies to the work it sends them: an animation's
/// changes show in the frame that asked for them, unless the script takes longer, when they show
/// in a later one, which doesn't wait for them.
const FRAME_WAIT: Duration = Duration::from_millis(100);
/// How long a script works on before the app asks whether to wait for it, in seconds.
const NOT_RESPONDING: f64 = 5.0;

/// How many log lines are kept.
const LOG_LINES: usize = 1000;

/// How far into the scripts folder the panel looks, and how many entries it lists at most.
const MAX_DEPTH: usize = 8;
pub(crate) const MAX_ENTRIES: usize = 5000;

/// The scripts that keep running, the console, and what they printed.
#[derive(Default)]
pub struct Scripts {
    running: Vec<Running>,
    /// The console's runtime, made on its first line.
    console: Option<Running>,
    log: Vec<LogLine>,
    /// The scripts folder as last listed, with the folder it lists. Dropped when the app comes to
    /// the front, as scripts may have been added, renamed or edited elsewhere meanwhile.
    tree: Option<(Vec<ScriptFolder>, Vec<Entry>)>,
    /// A script or folder just created, for the panel to select.
    created: Option<PathBuf>,
    /// Whether the app had the focus at the last frame.
    focused: bool,
    /// The pointer events for the tool script this frame, and the document they're on.
    pointer: Option<(u64, Vec<Pointer>)>,
    /// The open documents as of the last frame (`DocState::uid`), to tell the scripts which closed.
    documents: Vec<u64>,
    /// The scripts folders whose `__init__` scripts ran.
    initialized: Option<Vec<ScriptFolder>>,
    /// The tool script the Scriptographer Tool button stands for: the last one run, until it fails.
    tool: Option<ToolScript>,
    /// Whether the Scriptographer Tool is the active tool: the canvas then sends its pointer events to
    /// the tool script.
    tool_active: bool,
    /// The keys typed on the canvas that wait for the scripts listening for them, in order.
    held: VecDeque<Held>,
    /// What the user picked in the browser for a script's file dialog, by script, as the picker
    /// answers, later (the web: [`pick`]).
    #[cfg(target_arch = "wasm32")]
    picked: Rc<RefCell<Vec<(u64, Picked)>>>,
}

/// What the browser's picker gave a script's file dialog: nothing when the user cancelled.
#[cfg(target_arch = "wasm32")]
type Picked = Option<vectorcraft_scriptographer::Picked>;

/// A key typed on the canvas, with the text it types, while the scripts listening for it on their
/// `document` answer whether a listener prevented its default: the app then leaves it.
struct Held {
    events: Vec<egui::Event>,
    /// The ids of the scripts yet to answer.
    owing: Vec<u64>,
    prevented: bool,
}

/// A line of script output.
pub struct LogLine {
    pub text: String,
    pub error: bool,
}

/// A folder or script in the scripts folder.
pub struct Entry {
    pub name: String,
    pub path: PathBuf,
    pub kind: EntryKind,
}

pub enum EntryKind {
    Folder(Vec<Entry>),
    /// A script; `tool` when it defines mouse or key handlers, which makes it a tool.
    Script {
        tool: bool,
    },
}

/// The tool script, as the Scriptographer Tool stands for it while it runs.
struct ToolScript {
    path: PathBuf,
    /// Whether its tool handles keys: the keys typed on the canvas are then its own.
    keys: bool,
}

/// A script that runs, on its thread.
struct Running {
    /// Names it for the dialog it waits on.
    id: u64,
    /// The file name, for messages.
    name: String,
    /// The file it runs, if any (not for the console).
    path: Option<PathBuf>,
    worker: Worker,
    /// The app's clock when it started, in seconds.
    started: f64,
    /// Each document after the script's last change in it (`DocState::uid`): while it is still the
    /// document, the next change there adds to the same undo step.
    last: Vec<(u64, Arc<Document>)>,
    /// Whether the script made a tool: it then keeps running, as the Scriptographer Tool's.
    tool: bool,
    /// When it next needs a frame, as its last work said: when its next timer is due (`onFrame`,
    /// intervals), in milliseconds on its clock.
    wake: Option<f64>,
    /// Whether it defines effects, as its last work said: they draw in a frame once the document
    /// changed.
    effects: bool,
    /// The document as the script last had it.
    seen: Option<Arc<Document>>,
    /// The work it was sent and hasn't finished.
    busy: Option<Kind>,
    /// Since when, on the app's clock, it has been working without a break, or since the user
    /// last chose to wait for it.
    busy_since: Option<f64>,
    /// Whether the app asks whether to wait for it, or stop it.
    unresponsive: bool,
    /// The work waiting to be sent: pointer events while it works.
    queued: VecDeque<Work>,
    /// The dialog it waits on (`Dialog.alert`, `confirm`, `prompt`).
    asking: Option<Asking>,
    /// Whether the user cancelled its last file dialog: its next one asks first, in the app's
    /// dialog, which can stop it, as a script that asks again at once would otherwise keep the
    /// user in the system's file picker, where the app's menus are out of reach.
    cancelled_pick: bool,
    /// Its palettes (`new Palette`), as they show.
    palettes: Vec<PaletteView>,
    /// Whether it has palettes open, as its last work said: it then keeps running.
    open: bool,
    /// Whether it listens for keys on its `document` or `window`: it then keeps running too.
    listening: bool,
    /// Its answers to the keys sent to its `document` ([`Held`]), in order, until matched.
    answers: VecDeque<bool>,
    /// Whether it set `script.keepAlive`: it then goes on when another script runs.
    keep_alive: bool,
}

/// A script's palette, as the panel shows it.
struct PaletteView {
    id: u64,
    title: String,
    /// As the script describes them, values included.
    components: Vec<Value>,
    /// The values by name, as the panel shows them.
    values: serde_json::Map<String, Value>,
    /// Its top left corner, once shown.
    pos: Option<egui::Pos2>,
}

/// A script's dialog: its question, and whether it shows (it waits while another dialog is open).
struct Asking {
    question: Value,
    shown: bool,
}

/// What a script's work is, while it does it.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Kind {
    Execute,
    Frame,
    Mouse,
    Key,
    Palette,
    Activate,
    Handler,
    /// An answer to a dialog, on the web.
    #[cfg(target_arch = "wasm32")]
    Answer,
}

impl Scripts {
    /// Whether a script has timers or effects, or is working (not waiting on a dialog).
    #[cfg(test)]
    pub fn is_running(&self) -> bool {
        self.running.iter().chain(&self.console).any(|s| s.wake.is_some() || s.effects || (s.busy.is_some() && s.asking.is_none()))
    }

    /// How long until a script needs a frame, in seconds from `now` on the app's clock: none while
    /// one works (not waiting on a dialog), whose replies each frame takes, else until its next
    /// timer is due.
    fn next_frame(&self, now: f64) -> Option<f64> {
        let wait = |s: &Running| {
            if s.busy.is_some() && s.asking.is_none() { Some(0.0) } else { s.wake.map(|wake| (s.started + wake / 1000.0 - now).max(0.0)) }
        };
        self.running.iter().chain(&self.console).filter_map(wait).reduce(f64::min)
    }

    /// The tool script the Scriptographer Tool button stands for.
    pub fn tool(&self) -> Option<&Path> {
        self.tool.as_ref().map(|t| t.path.as_path())
    }

    /// The tool script, while the Scriptographer Tool is the active tool.
    pub fn active_tool(&self) -> Option<&Path> {
        self.tool().filter(|_| self.tool_active)
    }

    /// Makes the Scriptographer Tool the active tool, when a tool script is assigned to it.
    pub fn select_tool(&mut self) {
        self.tool_active = self.tool.is_some();
        self.activate_tool(self.tool_active);
    }

    /// Tells the tool scripts the user picked their tool, or another one.
    fn activate_tool(&mut self, active: bool) {
        for script in self.running.iter_mut().filter(|s| s.tool) {
            script.queued.push_back(Work::Activate(active));
        }
    }

    /// Unloads the tool scripts the Scriptographer Tool no longer stands for, and lets the tool go
    /// when its script stopped.
    fn tidy(&mut self) {
        let tool = self.tool.as_ref().map(|t| t.path.clone());
        self.running.retain(|s| !s.tool || s.path == tool);
        if !self.running.iter().any(|s| s.tool) {
            self.tool = None;
            self.tool_active = false;
        }
    }

    /// Makes the app's own tools active again: the canvas no longer sends pointer events to the
    /// tool script, which stays assigned to the Scriptographer Tool.
    pub fn deselect_tool(&mut self) {
        if self.tool_active {
            self.tool_active = false;
            self.activate_tool(false);
        }
    }

    /// The files of the running scripts.
    pub fn running_paths(&self) -> BTreeSet<PathBuf> {
        self.running.iter().filter_map(|s| s.path.clone()).collect()
    }

    pub fn log(&self) -> &[LogLine] {
        &self.log
    }

    pub fn clear_log(&mut self) {
        self.log.clear();
    }

    fn push_log(&mut self, text: String, error: bool) {
        self.log.push(LogLine { text, error });
        if self.log.len() > LOG_LINES {
            self.log.drain(..self.log.len() - LOG_LINES);
        }
    }

    /// The scripts in the shown `folders`, each one a root under its name, listed again when
    /// `reload` or when the folders changed.
    pub fn tree(&mut self, folders: &[ScriptFolder], reload: bool) -> &[Entry] {
        if reload || self.tree.as_ref().is_none_or(|(listed, _)| listed != folders) {
            let mut count = 0;
            let roots = folders
                .iter()
                .filter(|f| f.visible && Path::new(&f.path).is_dir())
                .map(|f| {
                    let path = PathBuf::from(&f.path);
                    Entry { name: f.name.clone(), kind: EntryKind::Folder(list(&path, 1, &mut count)), path }
                })
                .collect();
            self.tree = Some((folders.to_vec(), roots));
        }
        self.tree.as_ref().map_or(&[], |(_, entries)| entries)
    }

    /// Lists the scripts folders again when they show next.
    pub(crate) fn forget_tree(&mut self) {
        self.tree = None;
    }

    /// The script or folder just created, once.
    pub(crate) fn take_created(&mut self) -> Option<PathBuf> {
        self.created.take()
    }
}

/// The folders and scripts in `folder`, folders first, each sorted by name.
fn list(folder: &Path, depth: usize, count: &mut usize) -> Vec<Entry> {
    let Ok(read) = std::fs::read_dir(folder) else {
        return Vec::new();
    };
    let mut entries: Vec<Entry> = read
        .filter_map(Result::ok)
        .filter_map(|e| {
            let path = e.path();
            let name = e.file_name().to_string_lossy().into_owned();
            // Hidden files, and the `__init__` scripts that run by themselves, don't show.
            if name.starts_with('.') || name.starts_with("__") || *count >= MAX_ENTRIES {
                return None;
            }
            *count += 1;
            if path.is_dir() {
                let children = if depth < MAX_DEPTH { list(&path, depth + 1, count) } else { Vec::new() };
                Some(Entry { name, path, kind: EntryKind::Folder(children) })
            } else if path.extension().is_some_and(|e| EXTS.iter().any(|x| e.eq_ignore_ascii_case(x))) {
                let tool = std::fs::read_to_string(&path).is_ok_and(|source| is_tool(&source));
                Some(Entry { name, path, kind: EntryKind::Script { tool } })
            } else {
                None
            }
        })
        .collect();
    entries.sort_by(|a, b| {
        let folder = |e: &Entry| !matches!(e.kind, EntryKind::Folder(_));
        (folder(a), a.name.to_lowercase()).cmp(&(folder(b), b.name.to_lowercase()))
    });
    entries
}

/// The `__init__` scripts in `folder` and the folders in it, sorted by name, among the first
/// [`MAX_ENTRIES`] entries, as the panel lists them.
fn init_scripts(folder: &Path, depth: usize, count: &mut usize) -> Vec<PathBuf> {
    let Ok(read) = std::fs::read_dir(folder) else {
        return Vec::new();
    };
    let mut paths: Vec<PathBuf> = read.filter_map(Result::ok).map(|e| e.path()).collect();
    paths.sort();
    let mut found = Vec::new();
    for path in paths {
        if *count >= MAX_ENTRIES {
            break;
        }
        *count += 1;
        let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        if path.is_dir() && !name.starts_with('.') && depth < MAX_DEPTH {
            found.extend(init_scripts(&path, depth + 1, count));
        } else if name.starts_with("__init__") && path.extension().is_some_and(|e| EXTS.iter().any(|x| e.eq_ignore_ascii_case(x))) {
            found.push(path);
        }
    }
    found
}

/// Whether a script is a tool: it defines mouse or key handlers, or uses `tool`, the test
/// PaperScript makes before giving a script its tool.
pub fn is_tool(source: &str) -> bool {
    const HANDLERS: [&str; 6] = ["onMouseDown", "onMouseUp", "onMouseDrag", "onMouseMove", "onKeyDown", "onKeyUp"];
    source.contains("tool.") || HANDLERS.iter().any(|h| source.contains(h))
}

/// `ui.runScript`: run the script at `path`, or the file the user picks. A script that is still
/// working after a moment goes on on its own: `started` instead of its result.
pub(crate) fn run(app: &mut VectorcraftApp, p: &Value) -> Result<Value, String> {
    if app.services.open_async.is_some() {
        return Err("Running scripts needs the desktop app".into());
    }
    let path = match p.get("path").and_then(Value::as_str) {
        Some(path) => path.to_owned(),
        None => {
            let pick = FilePick { filters: vec![FilePick::filter("Scripts", EXTS)], ..Default::default() };
            crate::picks::open(app, &pick).ok_or("cancelled")?
        }
    };
    let source = std::fs::read_to_string(&path).map_err(|e| format!("{path}: {e}"))?;
    let path = PathBuf::from(&path);
    let before = app.session.doc().map_err(|e| e.to_string())?.doc.clone();
    // As in Scriptographer, a script stops the ones that run, unless they set `script.keepAlive`,
    // and the tool script; run again, it replaces the one that runs from the same file.
    app.scripts.running.retain(|s| s.path.as_deref() != Some(&path) && (s.keep_alive || s.tool));
    let mut script = start(app, file_name(&path), Some(path), source)?;
    let result = execute(app, &mut script, RUN_WAIT);
    let changed = !Arc::ptr_eq(&before, &app.session.doc().map_err(|e| e.to_string())?.doc);
    let (working, running, tool) = (script.busy.is_some(), script.wake.is_some() || script.effects, script.tool);
    if result == Ok(true) {
        app.scripts.running.push(script);
    }
    // A tool script that failed is no longer the tool's:
    app.scripts.tidy();
    result?;
    if working {
        return Ok(json!({ "started": true }));
    }
    Ok(json!({ "changed": changed, "running": running, "tool": tool }))
}

/// `ui.evaluateScript {code}`: run `code` in the console's project, made on the first line.
pub(crate) fn evaluate(app: &mut VectorcraftApp, p: &Value) -> Result<Value, String> {
    let code = p.get("code").and_then(Value::as_str).ok_or("missing code")?.to_owned();
    let mut console = match app.scripts.console.take() {
        Some(console) => console,
        None => start(app, "Console".into(), None, String::new())?,
    };
    app.scripts.push_log(format!("> {code}"), false);
    let before = app.session.doc().map_err(|e| e.to_string())?.doc.clone();
    console.queued.push_back(Work::Execute(code));
    let result = execute(app, &mut console, RUN_WAIT);
    let changed = !Arc::ptr_eq(&before, &app.session.doc().map_err(|e| e.to_string())?.doc);
    app.scripts.console = Some(console);
    result?;
    Ok(json!({ "changed": changed }))
}

/// `ui.stopScripts`: stop every running script, and the console's `onFrame` and intervals.
pub(crate) fn stop(app: &mut VectorcraftApp) -> Result<Value, String> {
    notify(app, "onStop");
    let stopped = app.scripts.running.len();
    app.scripts.running.clear();
    app.scripts.console = None;
    app.scripts.tool = None;
    app.scripts.tool_active = false;
    if app.ui.dialog.as_ref().is_some_and(|d| crate::dialogs::script::is_script_dialog(&d.kind)) {
        app.ui.dialog = None;
    }
    Ok(json!({ "stopped": stopped }))
}

/// Stops the script with id `id`, which may be stuck: unlike [`stop`], its `onStop` isn't called.
pub(crate) fn stop_script(app: &mut VectorcraftApp, id: u64) {
    app.scripts.running.retain(|s| s.id != id);
    if app.scripts.console.as_ref().is_some_and(|s| s.id == id) {
        app.scripts.console = None;
    }
    app.scripts.tidy();
}

/// Asks whether to wait for a script that has been working for [`NOT_RESPONDING`] seconds, or to
/// stop it, as browsers ask about a page that hangs, one at a time while no other dialog is open.
/// The question goes once the script is done; Wait asks again after as long.
fn not_responding(app: &mut VectorcraftApp, now: f64) {
    let open = app.ui.dialog.as_ref().filter(|d| d.kind == crate::dialogs::script::NOT_RESPONDING).and_then(|d| d.fields.get("script")?.as_u64());
    let mut ask = None;
    for script in app.scripts.running.iter_mut().chain(&mut app.scripts.console) {
        if script.busy.is_none() || script.asking.is_some() {
            script.busy_since = None;
            script.unresponsive = false;
        } else if script.unresponsive {
            // Once the question closed, the user chose to wait:
            if open != Some(script.id) {
                script.busy_since = Some(now);
                script.unresponsive = false;
            }
        } else if now - *script.busy_since.get_or_insert(now) >= NOT_RESPONDING && ask.is_none() && app.ui.dialog.is_none() {
            script.unresponsive = true;
            ask = Some((script.id, script.name.clone()));
        }
    }
    // The script finished, or stopped:
    if open.is_some_and(|id| !app.scripts.running.iter().chain(&app.scripts.console).any(|s| s.id == id && s.unresponsive)) {
        app.ui.dialog = None;
    }
    if let Some((id, name)) = ask {
        crate::dialogs::script::open_not_responding(app, id, &name);
    }
}

/// Calls the scripts' `handler` ([`vectorcraft_scriptographer::HANDLERS`]), where they define it.
/// A script whose handler throws stops, as one does whose frame throws.
pub(crate) fn notify(app: &mut VectorcraftApp, handler: &'static str) {
    let mut scripts = std::mem::take(&mut app.scripts.running);
    scripts.extend(app.scripts.console.take());
    let until = Instant::now() + FRAME_WAIT;
    scripts.retain_mut(|script| {
        script.queued.push_back(Work::Handler(handler));
        let result = pump(app, script, None, until);
        if let Err(e) = &result {
            report(app, &script.name, e);
        }
        result.is_ok()
    });
    // The console is the one without a file.
    if let Some(i) = scripts.iter().position(|s| s.path.is_none()) {
        app.scripts.console = Some(scripts.remove(i));
    }
    scripts.append(&mut app.scripts.running);
    app.scripts.running = scripts;
}

/// A script's thread, to run `source` (queued, as the first work).
fn start(app: &VectorcraftApp, name: String, path: Option<PathBuf>, source: String) -> Result<Running, String> {
    let state = app.session.doc().map_err(|e| e.to_string())?;
    let size = state.doc.artboards.first().map_or((800.0, 600.0), |a| (a.rect.width(), a.rect.height()));
    let file = path.as_ref().map(|p| p.to_string_lossy().into_owned());
    let setup = Setup {
        file,
        storage: app.ui.scriptographer_storage.clone(),
        cache: app.ui.scriptographer_cache.clone(),
        language: Some(app.ui_language().code().to_owned()),
    };
    let worker = Worker::spawn(size, setup).map_err(|e| e.to_string())?;
    let queued = if source.is_empty() { VecDeque::new() } else { VecDeque::from([Work::Execute(source)]) };
    static NEXT_ID: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
    let id = NEXT_ID.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    Ok(Running {
        id,
        name,
        path,
        worker,
        started: app.last_time,
        last: Vec::new(),
        tool: false,
        wake: None,
        effects: false,
        seen: None,
        busy: None,
        queued,
        asking: None,
        cancelled_pick: false,
        busy_since: None,
        unresponsive: false,
        palettes: Vec::new(),
        open: false,
        listening: false,
        answers: VecDeque::new(),
        keep_alive: false,
    })
}

/// Runs the script's queued work, waiting at most `wait` for it. Returns whether it keeps
/// running, or reports its error.
fn execute(app: &mut VectorcraftApp, script: &mut Running, wait: Duration) -> Result<bool, String> {
    pump(app, script, None, Instant::now() + wait).inspect_err(|e| report(app, &script.name, e))
}

/// Drives the running scripts, once per frame: their queued work, timers and `onFrame` handlers
/// run, and what they changed goes back to the document.
pub(crate) fn frame(app: &mut VectorcraftApp, ctx: &egui::Context, now: f64) {
    #[cfg(target_arch = "wasm32")]
    for (id, picked) in std::mem::take(&mut *app.scripts.picked.borrow_mut()) {
        if let Some(script) = app.scripts.running.iter_mut().chain(&mut app.scripts.console).find(|s| s.id == id) {
            script.queued.push_back(Work::Picked(picked));
        }
    }
    let focused = ctx.input(|i| i.focused);
    if focused != app.scripts.focused {
        app.scripts.focused = focused;
        if focused {
            app.scripts.tree = None;
        }
        notify(app, if focused { "onAppActivate" } else { "onAppDeactivate" });
    }
    // The folders' `__init__` scripts run once a document is open, and again when the folders
    // change, as in Scriptographer.
    if app.session.active().is_some() && app.scripts.initialized.as_ref() != Some(&app.ui.scriptographer_folders) {
        let folders = app.ui.scriptographer_folders.clone();
        app.scripts.initialized = Some(folders.clone());
        let mut count = 0;
        for path in folders.iter().filter(|f| f.visible).flat_map(|f| init_scripts(Path::new(&f.path), 0, &mut count)) {
            // A failing script says so in the log.
            let _ = run(app, &json!({ "path": path.to_string_lossy() }));
        }
        notify(app, "onStartup");
    }
    // The scripts let go of the documents that closed:
    let documents: Vec<u64> = app.session.documents().iter().map(|d| d.uid).collect();
    for uid in app.scripts.documents.iter().filter(|uid| !documents.contains(uid)) {
        for script in app.scripts.running.iter().chain(&app.scripts.console) {
            script.worker.send(Request::Closed(*uid));
        }
    }
    app.scripts.documents = documents;
    if app.scripts.running.is_empty() && app.scripts.console.is_none() {
        return;
    }
    clipboard(app, ctx);
    dialogs(app);
    let until = Instant::now() + FRAME_WAIT;
    let mut scripts = std::mem::take(&mut app.scripts.running);
    scripts.retain_mut(|script| {
        let keeps = pump(app, script, Some((now - script.started) * 1000.0), until).unwrap_or_else(|e| {
            report(app, &script.name, &e);
            false
        });
        if !keeps {
            app.scripts.push_log(format!("{} stopped", script.name), false);
        }
        keeps
    });
    // Scripts started by a script's frame join the list.
    scripts.append(&mut app.scripts.running);
    app.scripts.running = scripts;
    app.scripts.tidy();
    if let Some(mut console) = app.scripts.console.take() {
        let ms = (now - console.started) * 1000.0;
        if let Err(e) = pump(app, &mut console, Some(ms), until) {
            report(app, &console.name, &e);
        }
        app.scripts.console = Some(console);
    }
    not_responding(app, now);
    // Held keys wait for the scripts' answers, which each frame takes.
    let wait = if app.scripts.held.is_empty() { app.scripts.next_frame(now) } else { Some(0.0) };
    if let Some(wait) = wait {
        ctx.request_repaint_after(Duration::from_secs_f64(wait));
    }
}

/// Sends the script its queued work, then its frame at `frame` (milliseconds since it started)
/// when its next timer is due, or its effects have a document to catch up with, one at a time,
/// each with the document as it is, and applies what each one changed. Waits for its work until
/// `until`, but not for work that already outlasted an earlier frame: a script still working then
/// goes on in a later frame. Returns whether the script keeps running, or the error of the work
/// that failed.
fn pump(app: &mut VectorcraftApp, script: &mut Running, mut frame: Option<f64>, until: Instant) -> Result<bool, String> {
    let now = frame.unwrap_or((app.last_time - script.started) * 1000.0);
    let mut sent = false;
    loop {
        // Waiting on a dialog, or for a document to work in: nothing else until then.
        if script.asking.is_some() || app.session.active().is_none() {
            return Ok(true);
        }
        if script.busy.is_none() {
            let work = match script.queued.pop_front() {
                Some(work) => work,
                None => match frame.take() {
                    // On the web, its Promise continuations change its project after its work.
                    Some(_) if script.wake.is_some_and(|wake| wake <= now) || is_behind(app, script) || script.worker.has_changes() => Work::Frame,
                    _ => return Ok(script.wake.is_some() || script.effects || script.tool || script.open || script.listening),
                },
            };
            send(app, script, now, work)?;
            sent = true;
        }
        let Some(kind) = script.busy else {
            return Ok(true);
        };
        // Work that outlasted an earlier frame's wait isn't waited for again.
        let wait = if sent || script.busy_since.is_none() { until } else { Instant::now() };
        let Some(Done { error, tool, keys }) = settle(app, script, wait) else {
            return Ok(true);
        };
        if let Some(error) = error {
            return Err(error);
        }
        if kind == Kind::Execute
            && tool
            && let Some(path) = script.path.clone()
        {
            // As Scriptographer's tool button: the tool script runs, and its tool is the active
            // tool.
            script.tool = true;
            if app.scripts.tool().is_none_or(|t| t != path) {
                app.scripts.tool = Some(ToolScript { path, keys });
                app.scripts.tool_active = true;
                script.queued.push_back(Work::Activate(true));
            }
        }
    }
}

/// Whether the script has effects that haven't seen the active document yet.
fn is_behind(app: &VectorcraftApp, script: &Running) -> bool {
    script.effects && app.session.active().is_some_and(|d| !script.seen.as_ref().is_some_and(|seen| Arc::ptr_eq(seen, &d.doc)))
}

/// Sends `work` to the script at `now` (milliseconds since it started), with the active document.
fn send(app: &mut VectorcraftApp, script: &mut Running, now: f64, work: Work) -> Result<(), String> {
    let index = app.session.active_index().ok_or("no document is open")?;
    let state = app.session.documents().get(index).ok_or("no document is open")?;
    let (uid, doc, selection) = (state.uid, state.doc.clone(), state.selection.clone());
    // The document's view has its active artboard, the script's `project.activeArtboard`.
    let artboard = app.views.get(index).map_or(0, |v| v.artboard);
    script.busy = Some(match &work {
        Work::Execute(_) => Kind::Execute,
        Work::Frame => Kind::Frame,
        Work::Key(..) | Work::DocumentKey(_) => Kind::Key,
        Work::Palette(..) => Kind::Palette,
        Work::Activate(_) => Kind::Activate,
        Work::Handler(_) => Kind::Handler,
        #[cfg(target_arch = "wasm32")]
        Work::Answer(_) | Work::Picked(_) => Kind::Answer,
        Work::Mouse(events) => {
            if events.iter().any(|(event, ..)| *event == MouseEvent::Down) {
                // A drag starts its own undo step.
                script.last.clear();
            }
            Kind::Mouse
        }
    });
    let paint = &app.session.paint;
    let text = app.session.new_type_style();
    let style = vectorcraft_scriptographer::host::current_style(&paint.fill, &paint.stroke, paint.stroke_width, &text.fill);
    script.seen = Some(doc.clone());
    script.worker.send(Request::Run { uid, doc, selection, artboard, style, now, work });
    Ok(())
}

/// How a script's work ended: its error, whether it made a tool, and whether that handles keys.
struct Done {
    error: Option<String>,
    tool: bool,
    keys: bool,
}

/// Applies what the script's work changed as its replies come, until the work is done, the script
/// asks a dialog, or `until`.
fn settle(app: &mut VectorcraftApp, script: &mut Running, until: Instant) -> Option<Done> {
    let mut failed = None;
    while let Some(reply) = script.worker.recv(until.saturating_duration_since(Instant::now())) {
        match reply {
            Reply::Changes { uid, patch, base, before, selected, effects } => {
                if let Err(e) = write_back(app, script, uid, patch, base, &before, &selected, effects) {
                    failed.get_or_insert(e);
                }
            }
            Reply::Key { prevented } => script.answers.push_back(prevented),
            Reply::Ask(question) => {
                script.asking = Some(Asking { question, shown: false });
                // The script waits for the answer; on the web it went on, and its work ends.
                #[cfg(not(target_arch = "wasm32"))]
                return None;
            }
            Reply::Done { output, error, wake, effects, tool, keys, palettes, open, listening, keep_alive } => {
                show_output(app, output);
                script.busy = None;
                script.wake = wake;
                script.effects = effects;
                script.open = open;
                script.listening = listening;
                script.keep_alive = keep_alive;
                show_palettes(script, palettes);
                return Some(Done { error: error.or(failed), tool, keys });
            }
        }
    }
    None
}

/// Puts the palettes the script reports as new or changed in the ones it shows.
fn show_palettes(script: &mut Running, palettes: Vec<Value>) {
    for palette in palettes {
        let Some(id) = palette["id"].as_u64() else {
            continue;
        };
        let components = palette["components"].as_array().cloned().unwrap_or_default();
        let values = components.iter().filter_map(|c| Some((c["name"].as_str()?.to_owned(), c["value"].clone()))).collect();
        let title = palette["title"].as_str().unwrap_or_default().to_owned();
        match script.palettes.iter_mut().find(|p| p.id == id) {
            Some(view) => (view.title, view.components, view.values) = (title, components, values),
            None => script.palettes.push(PaletteView { id, title, components, values, pos: None }),
        }
    }
}

/// The height of a palette's title bar.
pub(crate) const PALETTE_BAR: f32 = 26.0;

/// `pos` moved so a palette of `size` stays on `screen`, its top-left corner first.
fn clamp_palette(pos: egui::Pos2, size: egui::Vec2, screen: egui::Rect) -> egui::Pos2 {
    let pos = if pos.x.is_finite() && pos.y.is_finite() { pos } else { screen.left_top() + egui::vec2(60.0, 100.0) };
    let fit = |v: f32, max: f32| if v > max { max.floor() } else { v };
    egui::pos2(fit(pos.x, screen.right() - size.x).max(screen.left()), fit(pos.y, screen.bottom() - size.y).max(screen.top()))
}

/// The scripts' palettes, as floating panels: what the user changes goes into the panel at once,
/// and to the script as work. The × closes a palette. A palette opens where the user last put the
/// script's palette of that title.
pub(crate) fn palettes(app: &mut VectorcraftApp, ctx: &egui::Context) {
    use crate::dialogs::script::{Edit, Layout, component, is_menu};
    let t = crate::theme::Tokens::get(ctx);
    let screen = ctx.content_rect();
    let start = screen.center() - egui::vec2(120.0, 120.0);
    let mut events = Vec::new();
    let mut shown = 0.0;
    for script in app.scripts.running.iter_mut().chain(&mut app.scripts.console) {
        let file = script.path.as_ref().map_or_else(|| script.name.clone(), |p| p.to_string_lossy().into_owned());
        for view in &mut script.palettes {
            let key = format!("{file}\u{1f}{}", view.title);
            let placed = app.ui.scriptographer_palettes.get(&key).map(|p| egui::pos2(p[0], p[1]));
            // A new area shows from its second frame, once it knows its size.
            if view.pos.is_none() {
                ctx.request_repaint();
            }
            let pos = *view.pos.get_or_insert_with(|| placed.unwrap_or(start + egui::vec2(shown, shown)));
            shown += 24.0;
            let area = egui::Id::unique(("scriptographer-palette", script.id, view.id));
            let size = ctx.memory(|m| m.area_rect(area)).map_or(egui::vec2(300.0, 200.0), |r| r.size());
            let pos = clamp_palette(pos, size, screen);
            egui::Area::new(area).order(egui::Order::Middle).fixed_pos(pos).show(ctx, |ui| {
                let frame = egui::Frame::popup(ui.style()).fill(t.panel).corner_radius(4).inner_margin(egui::Margin::ZERO);
                let layout = Layout::new(ui, &view.components);
                frame.show(ui, |ui| {
                    // As wide as the components, and the title.
                    let title = ui.painter().layout_no_wrap(view.title.clone(), crate::theme::semibold(12.0), t.text).size().x + 48.0;
                    ui.set_width((layout.width() + 16.0).max(title));
                    // Title bar: its title, the grip that moves it and the × that closes it.
                    let (bar, _) = ui.allocate_exact_size(egui::vec2(ui.available_width(), PALETTE_BAR), egui::Sense::hover());
                    ui.painter().rect_filled(bar, egui::CornerRadius { nw: 4, ne: 4, sw: 0, se: 0 }, t.tab_strip);
                    let close = egui::Rect::from_center_size(bar.right_center() - egui::vec2(13.0, 0.0), egui::vec2(18.0, 18.0));
                    ui.painter().text(
                        bar.left_center() + egui::vec2(8.0, 0.0),
                        egui::Align2::LEFT_CENTER,
                        &view.title,
                        crate::theme::semibold(12.0),
                        t.text,
                    );
                    // The grip ends before the menu button and the ×.
                    let grip = ui.interact(
                        egui::Rect::from_min_max(bar.min, egui::pos2(close.left() - 20.0, bar.bottom())),
                        ui.scope_id().with("grip"),
                        egui::Sense::drag(),
                    );
                    if grip.dragged() {
                        view.pos = Some(pos + grip.drag_delta());
                    }
                    if grip.drag_stopped() {
                        app.ui.scriptographer_palettes.insert(key.clone(), [pos.x, pos.y]);
                        app.prefs_changed = true;
                    }
                    let x = ui.interact(close, ui.scope_id().with("close"), egui::Sense::click());
                    crate::icons::paint(ui, "x", close.shrink(3.0), if x.hovered() { t.text_strong } else { t.text_dim });
                    if x.clicked() {
                        events.push((script.id, view.id, PaletteEvent::Close));
                    }
                    // Its menu entries, in its menu.
                    let entries: Vec<&Value> = view.components.iter().filter(|c| is_menu(c) && c["visible"].as_bool() != Some(false)).collect();
                    if !entries.is_empty() {
                        let rect = close.translate(egui::vec2(-20.0, 0.0));
                        let menu = ui.interact(rect, ui.scope_id().with("menu"), egui::Sense::click());
                        crate::icons::paint(ui, "menu", rect.shrink(3.0), if menu.hovered() { t.text_strong } else { t.text_dim });
                        egui::Popup::menu(&menu).show(|ui| {
                            ui.set_min_width(160.0);
                            for c in entries {
                                if c["type"] == "menu-separator" {
                                    ui.separator();
                                    continue;
                                }
                                let label = c["label"].as_str().map_or_else(|| crate::dialogs::script::text(&c["value"]), str::to_owned);
                                let enabled = c["enabled"].as_bool().unwrap_or(true);
                                if crate::widgets::menu_item_name(ui, &label, enabled, false)
                                    && let Some(name) = c["name"].as_str()
                                {
                                    events.push((script.id, view.id, PaletteEvent::Click(name.to_owned())));
                                }
                            }
                        });
                    }
                    egui::Frame::NONE.inner_margin(8).show(ui, |ui| {
                        for c in &view.components {
                            let Some(name) = c["name"].as_str() else {
                                continue;
                            };
                            match component(ui, &layout, c, view.values.get(name).unwrap_or(&Value::Null)) {
                                Some(Edit::Value(value)) => {
                                    view.values.insert(name.to_owned(), value.clone());
                                    events.push((script.id, view.id, PaletteEvent::Change(name.to_owned(), value)));
                                }
                                Some(Edit::Click) => events.push((script.id, view.id, PaletteEvent::Click(name.to_owned()))),
                                None => {}
                            }
                        }
                    });
                });
            });
        }
    }
    for (script, palette, event) in events {
        if let Some(script) = app.scripts.running.iter_mut().chain(&mut app.scripts.console).find(|s| s.id == script) {
            if event == PaletteEvent::Close {
                script.palettes.retain(|p| p.id != palette);
            }
            script.queued.push_back(Work::Palette(palette, event));
        }
        ctx.request_repaint();
    }
}

/// Answers the scripts that read or write the system clipboard (`navigator.clipboard`) at once,
/// with no dialog. Text goes there as a text field copies it, so Paste takes it as another app's.
fn clipboard(app: &mut VectorcraftApp, ctx: &egui::Context) {
    let asked: Vec<(u64, Value)> = app
        .scripts
        .running
        .iter()
        .chain(&app.scripts.console)
        .filter_map(|script| {
            script
                .asking
                .as_ref()
                .filter(|a| a.question["type"].as_str().is_some_and(|t| t.starts_with("clipboard")))
                .map(|a| (script.id, a.question.clone()))
        })
        .collect();
    for (id, question) in asked {
        let answer = match question["type"].as_str() {
            Some("clipboardRead") => json!({ "text": app.system_clipboard_text() }),
            _ => {
                ctx.copy_text(question["text"].as_str().unwrap_or_default().to_owned());
                json!({})
            }
        };
        if let Some(script) = app.scripts.running.iter_mut().chain(&mut app.scripts.console).find(|s| s.id == id) {
            reply(script, answer);
        }
    }
}

/// Shows the dialogs scripts wait on, one at a time while no other dialog is open, and answers a
/// dialog that closed without OK as Cancel would. The file dialogs are the app's file pickers.
fn dialogs(app: &mut VectorcraftApp) {
    let open = app.ui.dialog.as_ref().filter(|d| crate::dialogs::script::is_script_dialog(&d.kind)).and_then(|d| d.fields.get("script")?.as_u64());
    let picking = app.picks.is_waiting();
    let mut show = None;
    for script in app.scripts.running.iter_mut().chain(&mut app.scripts.console) {
        let Some(asking) = &mut script.asking else {
            continue;
        };
        // Only one file picker opens at a time, so an open one is this script's. A file dialog may
        // be the app's first, whose Choose… shows the picker ([`ask_to_pick`]).
        let is_picking = is_pick(&asking.question) && cfg!(not(target_arch = "wasm32")) && picking;
        if asking.shown && open != Some(script.id) && !is_picking {
            script.cancelled_pick = is_pick(&asking.question);
            let cancelled = crate::dialogs::script::cancelled(&asking.question);
            reply(script, cancelled);
        } else if !asking.shown && show.is_none() && app.ui.dialog.is_none() && !picking {
            asking.shown = true;
            show = Some((script.id, asking.question.clone(), script.cancelled_pick));
        }
    }
    match show {
        // On the web, browsers show their pickers only in a click, which Choose… is.
        Some((id, question, asks_first)) if is_pick(&question) && (asks_first || cfg!(target_arch = "wasm32")) => ask_to_pick(app, id, &question),
        #[cfg(not(target_arch = "wasm32"))]
        Some((id, question, _)) if is_pick(&question) => pick(app, id, &question),
        Some((id, question, _)) => crate::dialogs::script::open(app, id, &question),
        None => {}
    }
}

/// Whether `question` is for a file dialog: a script's file pickers and `Dialog`'s.
fn is_pick(question: &Value) -> bool {
    matches!(question["type"].as_str(), Some("openFile" | "openFiles" | "saveFile" | "chooseDirectory"))
}

/// The app's dialog whose Choose… shows the picker the script `id` asks for in `question`
/// ([`crate::dialogs::script::open_file`]), and whose Stop stops the script. On the web, what the
/// user picks reaches the script as its next work ([`frame`]). Cancel answers it as cancelled
/// ([`dialogs`]).
fn ask_to_pick(app: &mut VectorcraftApp, id: u64, question: &Value) {
    let name = app.scripts.running.iter().chain(&app.scripts.console).find(|s| s.id == id).map(|s| s.name.clone()).unwrap_or_default();
    crate::dialogs::script::open_file(app, id, &name, question);
}

/// What the browser's picker gave for the script `id`'s file dialog: the script is no longer
/// waiting on the app's dialog, and gets it as its next work ([`frame`]).
#[cfg(target_arch = "wasm32")]
pub(crate) fn picking(app: &mut VectorcraftApp, id: u64) -> Box<dyn FnOnce(Picked)> {
    if let Some(script) = app.scripts.running.iter_mut().chain(&mut app.scripts.console).find(|s| s.id == id) {
        script.asking = None;
    }
    let picked = app.scripts.picked.clone();
    Box::new(move |file| picked.borrow_mut().push((id, file)))
}

/// Shows the file picker the script `id` asks for in `question`, starting from its `path`, with its
/// file types. The path picked answers it (the paths, for several files, whose dialog has no file
/// types); a picker closed without one answers it as cancelled ([`dialogs`]).
#[cfg(not(target_arch = "wasm32"))]
pub(crate) fn pick(app: &mut VectorcraftApp, id: u64, question: &Value) {
    let kind = question["type"].as_str().unwrap_or_default().to_owned();
    let path = question["path"].as_str().map(PathBuf::from);
    // A folder to start in, or a file: its folder, and its name to suggest.
    let (folder, name) = match path {
        Some(path) if path.is_dir() => (Some(path), String::new()),
        Some(path) => (
            path.parent().filter(|p| !p.as_os_str().is_empty()).map(Path::to_path_buf),
            path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(),
        ),
        None => (None, String::new()),
    };
    let folder = folder.map(|f| f.to_string_lossy().into_owned());
    // The script's file types; one without extensions shows every file.
    let filters = question["filters"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|f| Some((f[0].as_str()?.to_owned(), f[1].as_array()?.iter().filter_map(|e| e.as_str().map(str::to_owned)).collect())))
        .collect();
    let file = FilePick { name, folder, filters };
    crate::picks::button(app, move |app| {
        let picked = match kind.as_str() {
            "openFile" => crate::picks::open(app, &file).map(|p| json!(p)),
            "openFiles" => Some(crate::picks::open_many(app, &file)).filter(|p| !p.is_empty()).map(|p| json!(p)),
            "saveFile" => crate::picks::save(app, &file).map(|p| json!(p)),
            _ => crate::picks::folder(app).map(|p| json!(p)),
        };
        if let Some(picked) = picked {
            answer(app, id, picked);
        }
    });
}

/// The user's answer to the dialog the script `id` waits on.
pub(crate) fn answer(app: &mut VectorcraftApp, id: u64, answer: Value) {
    if let Some(script) = app.scripts.running.iter_mut().chain(&mut app.scripts.console).find(|s| s.id == id && s.asking.is_some()) {
        script.cancelled_pick = false;
        reply(script, answer);
    }
}

/// Gives `script` the answer to the dialog it asked: on desktop, where it waits for it; on the
/// web, where it went on, as its next work, with the document as it is then.
fn reply(script: &mut Running, answer: Value) {
    #[cfg(not(target_arch = "wasm32"))]
    script.worker.send(Request::Answer(answer));
    #[cfg(target_arch = "wasm32")]
    script.queued.push_back(Work::Answer(answer));
    script.asking = None;
}

/// A script's file name, for messages.
fn file_name(path: &Path) -> String {
    path.file_name().unwrap_or(path.as_os_str()).to_string_lossy().into_owned()
}

/// Sends a pointer event on the canvas to the active tool script. Returns whether there is one,
/// which then has the event instead of the app's tool. Each drag is one undo step.
pub(crate) fn pointer(app: &mut VectorcraftApp, ev: &vectorcraft_tools::PointerEvent) -> bool {
    use vectorcraft_tools::PointerKind;
    let Some(active) = app.session.active().map(|d| d.uid).filter(|_| app.scripts.active_tool().is_some()) else {
        return false;
    };
    let event = match ev.kind {
        PointerKind::Down => MouseEvent::Down,
        PointerKind::Drag | PointerKind::Move => MouseEvent::Move,
        PointerKind::Up => MouseEvent::Up,
        PointerKind::DoubleClick => return true,
    };
    // `cmd` is Command on macOS, Ctrl elsewhere, as Paper.js's `modifiers.command` is.
    let mac = cfg!(target_os = "macos");
    let modifiers = Modifiers { shift: ev.mods.shift, control: ev.mods.ctrl || (ev.mods.cmd && !mac), alt: ev.mods.alt, meta: ev.mods.cmd && mac };
    // The frame's events go to the script together ([`flush_pointer`]), which gives them their times.
    if app.scripts.pointer.as_ref().is_none_or(|(doc, _)| *doc != active) {
        flush_pointer(app, app.last_time, 0.0);
    }
    app.scripts.pointer.get_or_insert_with(|| (active, Vec::new())).1.push((event, (ev.pos.x, ev.pos.y), modifiers, 0.0));
    true
}

/// Sends the active tool script the pointer events of this frame, in one go: it works through them,
/// and what they changed comes back as one change of the document, as a browser draws once a
/// frame. The events get the system's times where the platform has one for each of a kind
/// ([`crate::canvas::PointerTimes`]); else they came in over the `dt` seconds before the frame's
/// time `now`, and get times spread evenly over them, the last one `now`.
pub(crate) fn flush_pointer(app: &mut VectorcraftApp, now: f64, dt: f64) {
    if let Some((_, mut events)) = app.scripts.pointer.take() {
        // A stalled frame counts a tenth of a second at most.
        let (dt, count) = (dt.clamp(0.0, 0.1), events.len() as f64);
        for (i, event) in events.iter_mut().enumerate() {
            event.3 = now - dt * (count - 1.0 - i as f64) / count;
        }
        let times = &app.pointer_times;
        for (kind, times) in [(MouseEvent::Move, &times.moves), (MouseEvent::Down, &times.downs), (MouseEvent::Up, &times.ups)] {
            let mut of_kind: Vec<&mut Pointer> = events.iter_mut().filter(|event| event.0 == kind).collect();
            // The newest events go with the newest times: the system may have seen more, outside
            // the canvas.
            if of_kind.len() <= times.len() {
                for (event, time) in of_kind.iter_mut().rev().zip(times.iter().rev()) {
                    event.3 = *time;
                }
            }
        }
        to_tool(app, [Work::Mouse(events)]);
    }
}

/// Sends the keys typed on the canvas to the active tool script, when it handles keys: plain keys,
/// with Shift or not. Keys with Cmd, Ctrl or Alt stay the app's shortcuts, and so do Space (the
/// Hand tool) and Escape. The keys it gets are taken out of the frame's input.
pub(crate) fn keys(app: &mut VectorcraftApp, ctx: &egui::Context) {
    if !(app.scripts.tool.as_ref().is_some_and(|t| t.keys) && app.scripts.active_tool().is_some() && app.session.active().is_some()) {
        return;
    }
    let work = ctx.input_mut(|i| {
        let mut work = Vec::new();
        i.events.retain(|e| match e {
            egui::Event::Key { key, pressed, modifiers, .. }
                if !(modifiers.command || modifiers.ctrl || modifiers.alt) && !matches!(key, egui::Key::Space | egui::Key::Escape) =>
            {
                let (name, character) = paper_key(*key, modifiers.shift);
                work.push(Work::Key(*pressed, name, character, Modifiers { shift: modifiers.shift, ..Default::default() }));
                false
            }
            _ => true,
        });
        work
    });
    if !work.is_empty() {
        to_tool(app, work);
    }
}

/// Sends the keys typed on the canvas to the `document` of the scripts listening for them, as
/// `KeyboardEvent`s, and holds them back from the app until those answered: a key a listener
/// prevented the default of goes no further. The app waits for the answers for as long as a frame
/// waits for a script ([`FRAME_WAIT`]); keys a busy script hasn't answered then wait for later
/// frames, as do the keys typed after them.
pub(crate) fn document_keys(app: &mut VectorcraftApp, ctx: &egui::Context) {
    let listening: Vec<u64> = app.scripts.running.iter().chain(&app.scripts.console).filter(|s| s.listening).map(|s| s.id).collect();
    if listening.is_empty() && app.scripts.held.is_empty() {
        return;
    }
    let events = ctx.input_mut(|i| std::mem::take(&mut i.events));
    let mut kept = Vec::with_capacity(events.len());
    let mut typed = false;
    for event in events {
        match event {
            egui::Event::Key { key, physical_key, pressed, repeat, modifiers } if !listening.is_empty() => {
                let (name, code) = dom_key(key, physical_key.unwrap_or(key), modifiers.shift);
                let modifiers = Modifiers { shift: modifiers.shift, control: modifiers.ctrl, alt: modifiers.alt, meta: modifiers.mac_cmd };
                let work = Key { down: pressed, key: name, code, repeat, modifiers };
                for script in app.scripts.running.iter_mut().chain(&mut app.scripts.console).filter(|s| s.listening) {
                    script.queued.push_back(Work::DocumentKey(work.clone()));
                }
                app.scripts.held.push_back(Held { events: vec![event], owing: listening.clone(), prevented: false });
                typed = pressed;
            }
            // The text a key types goes with it:
            egui::Event::Text(_) if typed => {
                if let Some(held) = app.scripts.held.back_mut() {
                    held.events.push(event);
                }
            }
            _ => {
                typed = false;
                kept.push(event);
            }
        }
    }
    answer_keys(app);
    // The keys answered go on, ahead of the frame's other input:
    let mut events = Vec::new();
    while app.scripts.held.front().is_some_and(|h| h.owing.is_empty()) {
        if let Some(held) = app.scripts.held.pop_front()
            && !(held.prevented && held.events.iter().any(|e| matches!(e, egui::Event::Key { pressed: true, .. })))
        {
            events.extend(held.events);
        }
    }
    events.append(&mut kept);
    ctx.input_mut(|i| i.events = events);
}

/// Lets the scripts that owe answers to held keys work on them for up to [`FRAME_WAIT`] together,
/// and matches their answers with the keys; a script that failed or stopped owes none.
fn answer_keys(app: &mut VectorcraftApp) {
    let until = Instant::now() + FRAME_WAIT;
    let mut scripts = std::mem::take(&mut app.scripts.running);
    scripts.extend(app.scripts.console.take());
    scripts.retain_mut(|script| {
        if app.scripts.held.iter().any(|h| h.owing.contains(&script.id))
            && let Err(e) = pump(app, script, None, until)
        {
            report(app, &script.name, &e);
            return false;
        }
        for held in &mut app.scripts.held {
            if held.owing.contains(&script.id)
                && let Some(prevented) = script.answers.pop_front()
            {
                held.owing.retain(|id| *id != script.id);
                held.prevented |= prevented;
            }
        }
        true
    });
    for held in &mut app.scripts.held {
        held.owing.retain(|id| scripts.iter().any(|s| s.id == *id));
    }
    // The console is the one without a file.
    if let Some(i) = scripts.iter().position(|s| s.path.is_none()) {
        app.scripts.console = Some(scripts.remove(i));
    }
    scripts.append(&mut app.scripts.running);
    app.scripts.running = scripts;
}

/// A key's `key` and the `code` of the `physical` key, as the UI Events standard names them: `a`
/// or `A` and `KeyA`, `1` and `Digit1`, `ArrowLeft`, `Enter`, ` ` and `Space`.
fn dom_key(key: egui::Key, physical: egui::Key, shift: bool) -> (String, String) {
    use egui::Key as K;
    let arrow = |key: K| matches!(key, K::ArrowDown | K::ArrowLeft | K::ArrowRight | K::ArrowUp).then(|| format!("Arrow{}", key.name()));
    let name = match key {
        K::Space => " ".to_owned(),
        K::Minus => "-".to_owned(),
        key => arrow(key).unwrap_or_else(|| match key.symbol_or_name() {
            symbol if symbol.chars().count() == 1 => {
                if shift {
                    symbol.to_uppercase()
                } else {
                    symbol.to_lowercase()
                }
            }
            name => name.to_owned(),
        }),
    };
    let code = match physical {
        K::Equals => "Equal".to_owned(),
        K::OpenBracket => "BracketLeft".to_owned(),
        K::CloseBracket => "BracketRight".to_owned(),
        K::Backtick => "Backquote".to_owned(),
        K::SuperLeft => "MetaLeft".to_owned(),
        K::SuperRight => "MetaRight".to_owned(),
        physical => arrow(physical).unwrap_or_else(|| match physical.name() {
            letter if letter.len() == 1 && letter.chars().all(|c| c.is_ascii_alphabetic()) => format!("Key{letter}"),
            digit if digit.len() == 1 && digit.chars().all(|c| c.is_ascii_digit()) => format!("Digit{digit}"),
            name => name.to_owned(),
        }),
    };
    (name, code)
}

/// A key's name as Paper.js has it, as browsers name keys (`a`, `5`, `-`, `enter`, `left`,
/// `page-up`…), and the character it types.
fn paper_key(key: egui::Key, shift: bool) -> (String, Option<String>) {
    let symbol = match key {
        egui::Key::Minus => "-",
        key => key.symbol_or_name(),
    };
    if symbol.len() == 1 {
        let name = symbol.to_lowercase();
        let character = if shift { symbol.to_uppercase() } else { name.clone() };
        return (name, Some(character));
    }
    let mut name = String::new();
    for (i, c) in key.name().chars().enumerate() {
        if c.is_uppercase() && i > 0 {
            name.push('-');
        }
        name.extend(c.to_lowercase());
    }
    let character = match key {
        egui::Key::Enter => Some("\r".to_owned()),
        egui::Key::Tab => Some("\t".to_owned()),
        _ => None,
    };
    (name, character)
}

/// Sends `work` to the tool script.
fn to_tool(app: &mut VectorcraftApp, work: impl IntoIterator<Item = Work>) {
    let Some(index) = app.scripts.running.iter().position(|s| s.tool) else {
        return;
    };
    let mut script = app.scripts.running.remove(index);
    // Pointer events go by the script's clock, in seconds since it started, as its frames do.
    script.queued.extend(work.into_iter().map(|work| match work {
        Work::Mouse(mut events) => {
            for event in &mut events {
                event.3 -= script.started;
            }
            Work::Mouse(events)
        }
        work => work,
    }));
    match pump(app, &mut script, None, Instant::now() + FRAME_WAIT) {
        Ok(_) => app.scripts.running.push(script),
        Err(e) => report(app, &script.name, &e),
    }
    app.scripts.tidy();
}

/// The canvas cursor while the Scriptographer Tool is the active tool, as Scriptographer's tool had it:
/// a pencil, or the crosshair with Use Precise Cursors.
pub(crate) fn cursor(app: &VectorcraftApp) -> Option<Cursor> {
    app.scripts.active_tool()?;
    Some(if app.session.prefs.use_precise_cursors { Cursor::Script.precise() } else { Cursor::Script })
}

/// The Scriptographer Tool's button in the toolbox, under the app's tools, as Scriptographer's tool
/// button: dimmed until a tool script is run, then named after it and selected while it is the
/// active tool. Clicking it makes the tool script the active tool again; double-clicking it calls
/// the script's `onEditOptions()` too.
pub(crate) fn tool_button(app: &mut VectorcraftApp, ui: &mut egui::Ui, center_x: f32) {
    let t = crate::theme::Tokens::get(ui.ctx());
    let assigned = app.scripts.tool().map(file_name);
    let active = app.scripts.active_tool().is_some();
    ui.horizontal(|ui| {
        ui.add_space((center_x - 18.0 - ui.cursor().min.x).max(0.0));
        let (rect, resp) = ui.allocate_exact_size(egui::vec2(36.0, 30.0), egui::Sense::click());
        let well = egui::Rect::from_center_size(rect.center(), egui::vec2(30.0, 27.5));
        if active {
            ui.painter().rect_filled(well, egui::CornerRadius::same(6), t.tool_active);
        } else if resp.hovered() && assigned.is_some() {
            ui.painter().rect_filled(well, egui::CornerRadius::same(6), t.hover);
        }
        // Scriptographer's tool button: an outline pencil until a tool script is assigned to it,
        // then a coloured one (painted untinted).
        let icon = egui::Rect::from_center_size(rect.center(), egui::vec2(18.0, 18.0));
        match &assigned {
            Some(_) => crate::icons::paint(ui, "dc-scriptographer-tool-active", icon, egui::Color32::WHITE),
            None => crate::icons::paint(ui, "dc-scriptographer-tool", icon, t.text_disabled),
        }
        let tip = assigned.clone().unwrap_or_else(|| tl!("Run a tool script to assign it to this tool button").to_owned());
        let resp = resp.on_hover_text(tip);
        if resp.clicked() && assigned.is_some() {
            app.scripts.select_tool();
        }
        if resp.double_clicked() && assigned.is_some() {
            to_tool(app, [Work::Handler("onEditOptions")]);
        }
    });
}

/// An error from a script: in the log, which shows, and the status bar.
fn report(app: &mut VectorcraftApp, name: &str, error: &str) {
    let message = format!("{name}: {error}");
    app.scripts.push_log(message.clone(), true);
    show_console(app);
    app.status(message);
}

/// Shows the Scriptographer Console when it isn't showing, as Scriptographer's did when a script
/// printed.
fn show_console(app: &mut VectorcraftApp) {
    let params = json!({ "panel": crate::panels::scriptographer_console::ID });
    if crate::menus::checked(app, "window.panel", &params) != Some(true) {
        // Showing a panel doesn't fail.
        let _ = app.run("window.panel", params);
    }
}

/// Applies a script's `patch` of `base` to the document `uid`, adding to its undo step while
/// nothing else changed the document since its last change there, and leaving out what changed
/// since `base` when it is behind; then the objects it selected or deselected since `before`. The
/// worker gets the patch's result.
#[allow(clippy::too_many_arguments)]
fn write_back(
    app: &mut VectorcraftApp,
    script: &mut Running,
    uid: u64,
    patch: Option<Value>,
    base: Arc<Document>,
    before: &BTreeSet<NodeId>,
    selected: &BTreeSet<NodeId>,
    effects: bool,
) -> Result<(), String> {
    let document = |app: &VectorcraftApp| app.session.documents().iter().find(|d| d.uid == uid).map(|d| (d.doc.clone(), d.selection.clone()));
    let Some((current, _)) = document(app) else {
        // Its document closed meanwhile, and the script let go of it.
        if patch.is_some() {
            script.worker.send(Request::Applied { result: json!({}), doc: base, selection: Default::default(), behind: true });
        }
        return Ok(());
    };
    if let Some(mut params) = patch {
        let behind = !Arc::ptr_eq(&base, &current);
        let is_last = script.last.iter().any(|(other, last)| *other == uid && Arc::ptr_eq(last, &current));
        if let Some(params) = params.as_object_mut() {
            if behind {
                params.insert("keep".into(), vectorcraft_engine::cmd::patch::changes_between(&base, &current));
            }
            // What the script's effects drew belongs to the edit that changed their input, the
            // newest one; the script's own edits extend its own last one.
            if effects || !behind && is_last {
                params.insert("extend".into(), json!(true));
            }
        }
        let applied = run_in(app, uid, "document.patch", params);
        let (doc, selection) = document(app).ok_or("the script's document closed")?;
        // Drawing its effects into another's edit doesn't make that edit the script's.
        script.last.retain(|(other, _)| *other != uid);
        if !effects || is_last {
            script.last.push((uid, doc.clone()));
        }
        // A patch that failed changed nothing: the script reloads all that changed since `base`.
        let (result, behind) = match &applied {
            Ok(result) => (result.clone(), behind),
            Err(_) => (json!({}), true),
        };
        script.seen = Some(doc.clone());
        script.worker.send(Request::Applied { result, doc, selection, behind });
        applied?;
    }
    if selected != before {
        let (_, selection) = document(app).ok_or("the script's document closed")?;
        let mut ids: Vec<NodeId> = selection.objects.iter().copied().filter(|id| !before.contains(id) || selected.contains(id)).collect();
        ids.extend(selected.iter().filter(|id| !before.contains(id)));
        run_in(app, uid, "select.set", json!({ "ids": ids.iter().map(|id| id.0).collect::<Vec<_>>() }))?;
    }
    Ok(())
}

/// Runs the command `id` in the document `uid`: as the app runs it in the active document, and in
/// another one behind it.
fn run_in(app: &mut VectorcraftApp, uid: u64, id: &str, params: Value) -> Result<Value, String> {
    if app.session.active().is_some_and(|d| d.uid == uid) {
        app.run(id, params)
    } else {
        app.session.execute_in(uid, id, &params).map_err(|e| e.to_string())
    }
}

/// Puts what a script printed in the log, which shows, and its last line in the status bar.
fn show_output(app: &mut VectorcraftApp, output: Vec<String>) {
    let Some(last) = output.last() else {
        return;
    };
    app.status(last.clone());
    for line in output {
        app.scripts.push_log(line, false);
    }
    show_console(app);
}

/// `ui.editScript {path}`: opens the script in the system's editor for it.
pub(crate) fn edit_script(app: &mut VectorcraftApp, p: &Value) -> Result<Value, String> {
    let path = p.get("path").and_then(Value::as_str).ok_or("missing path")?;
    let open = app.services.open_file.as_mut().ok_or("no app to open files here")?;
    open(path)?;
    Ok(Value::Null)
}

/// `ui.revealScript {path}`: shows a script or folder in the system's file manager.
pub(crate) fn reveal(app: &mut VectorcraftApp, p: &Value) -> Result<Value, String> {
    let path = p.get("path").and_then(Value::as_str).ok_or("missing path")?;
    crate::io::reveal_path(app, path)?;
    Ok(Value::Null)
}

/// `ui.newScriptFolder {folder?, name?}`: a new folder in `folder` (else the first shown scripts
/// folder) named `name`; without one, a dialog asks for it, suggesting the first free Untitled N,
/// as in Scriptographer. Returns its path, or `pending`.
pub(crate) fn new_folder(app: &mut VectorcraftApp, p: &Value) -> Result<Value, String> {
    let folder = target_folder(app, p)?;
    let Some(name) = p.get("name").and_then(Value::as_str) else {
        let name = free_name(&folder, tl!("Untitled"), "");
        crate::dialogs::script_folders::new_folder(app, &folder, &name);
        return Ok(json!({ "pending": crate::dialogs::script_folders::NEW_FOLDER }));
    };
    let path = child(&folder, name)?;
    std::fs::create_dir(&path).map_err(|e| format!("{}: {e}", path.display()))?;
    created(app, path)
}

/// `ui.newScript {folder?, name?}`: a new, empty script in `folder` (else the first shown scripts
/// folder) named `name`; without one, a save dialog asks for it, suggesting the first free
/// Untitled N.js, as in Scriptographer. Returns its path.
pub(crate) fn new_script(app: &mut VectorcraftApp, p: &Value) -> Result<Value, String> {
    let folder = target_folder(app, p)?;
    let path = match p.get("name").and_then(Value::as_str) {
        Some(name) => child(&folder, name)?,
        None => {
            let name = free_name(&folder, tl!("Untitled"), ".js");
            let pick = FilePick { name, folder: Some(folder.to_string_lossy().into_owned()), filters: vec![FilePick::filter("Scripts", EXTS)] };
            let path = PathBuf::from(crate::picks::save(app, &pick).ok_or("cancelled")?);
            // The save dialog may have asked whether to replace a file: a new script never does.
            if path.exists() {
                return Err(format!("{} already exists", path.display()));
            }
            path
        }
    };
    std::fs::write(&path, "").map_err(|e| format!("{}: {e}", path.display()))?;
    created(app, path)
}

/// `p`'s `folder`, else the first scripts folder the panel shows; not one in a sealed folder (the
/// Examples), whose scripts and folders go in the first shown folder that isn't.
fn target_folder(app: &VectorcraftApp, p: &Value) -> Result<PathBuf, String> {
    let folders = &app.ui.scriptographer_folders;
    let is_sealed = |path: &Path| folders.iter().any(|f| f.sealed && path.starts_with(&f.path));
    match p.get("folder").and_then(Value::as_str).map(PathBuf::from) {
        Some(folder) if !is_sealed(&folder) => Ok(folder),
        _ => folders.iter().find(|f| f.visible && !f.sealed).map(|f| PathBuf::from(&f.path)).ok_or_else(|| "choose a scripts folder first".into()),
    }
}

/// Sets up the scripts folders at launch: writes the Examples to `examples`, the app's folder for
/// them, and lists it first and sealed when it isn't listed; on the first run, when no folders are
/// listed yet, also "My Scripts" at `my_scripts`, made when missing. A folder that can't be made
/// says so in the log.
#[cfg(not(target_arch = "wasm32"))]
pub fn set_up_script_folders(app: &mut VectorcraftApp, examples: &Path, my_scripts: Option<&Path>) {
    let first_run = app.ui.scriptographer_folders.is_empty();
    match crate::script_examples::install(examples) {
        Ok(()) => {
            let path = examples.to_string_lossy().into_owned();
            if !app.ui.scriptographer_folders.iter().any(|f| f.sealed && f.path == path) {
                let folder = ScriptFolder { sealed: true, ..ScriptFolder::new(tl!("Examples"), path) };
                app.ui.scriptographer_folders.insert(0, folder);
                app.prefs_changed = true;
            }
        }
        Err(e) => app.scripts.push_log(format!("{}: {e}", examples.display()), true),
    }
    if let Some(path) = my_scripts.filter(|_| first_run) {
        match std::fs::create_dir_all(path) {
            Ok(()) => {
                app.ui.scriptographer_folders.push(ScriptFolder::new(tl!("My Scripts"), path.to_string_lossy()));
                app.prefs_changed = true;
            }
            Err(e) => app.scripts.push_log(format!("{}: {e}", path.display()), true),
        }
    }
}

/// `name` in `folder`, when it is a plain file name not taken yet.
fn child(folder: &Path, name: &str) -> Result<PathBuf, String> {
    if name.is_empty() || Path::new(name).file_name().is_none_or(|n| n != name) {
        return Err(format!("{name}: not a file name"));
    }
    let path = folder.join(name);
    if path.exists() {
        return Err(format!("{} already exists", path.display()));
    }
    Ok(path)
}

/// `{base} N{ext}` with the first N from 1 that is free in `folder`.
fn free_name(folder: &Path, base: &str, ext: &str) -> String {
    (1u64..).map(|n| format!("{base} {n}{ext}")).find(|name| !folder.join(name).exists()).unwrap_or_default()
}

/// A script or folder made in a scripts folder: the panel lists it and selects it.
fn created(app: &mut VectorcraftApp, path: PathBuf) -> Result<Value, String> {
    app.scripts.tree = None;
    app.scripts.created = Some(path.clone());
    Ok(json!({ "path": path.to_string_lossy() }))
}
