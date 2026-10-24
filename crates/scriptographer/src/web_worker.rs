//! The workers of `Worker` outside a browser (`js/src/worker.js`): `new Worker(path)` runs the
//! script at `path` (from the script's folder, or an `https:` URL) as a classic script on a thread
//! of its own, in a runtime of its own, with the same APIs (and Paper.js, but no document).
//! Messages go both ways as structured serialization keeps them ([`crate::clone`]), with the ports
//! they transfer ([`crate::message_port`]), on the receiver's turn ([`poll`] in the parent). An uncaught error in the worker goes to the `Worker`,
//! and the worker goes on. The worker's console writes to its parent's. A worker ends with
//! `close()`, `worker.terminate()`, or its parent; while it runs, its parent does.
//!
//! `new SharedWorker(path, name)` connects to the one worker of that script and name that all of
//! the app's scripts share, as of one origin, started by the first: the script's `MessagePort`'s
//! other port goes to it, as its `connect` event. It ends with `close()`, or once every script that
//! connected is gone; its errors and its console go to all of them.

use std::sync::mpsc::{Receiver, RecvTimeoutError, SendError, Sender, channel};
use std::sync::{Arc, Mutex, Weak};
use std::time::{Duration, Instant};

use crate::message_port::{Ends, Message, message, receive};
use crate::{Call, Engine, Error, HostFunction, Interrupt, Runtime, Setup, Value};

/// How long a worker waits for a message before it runs its timers.
const FRAME: Duration = Duration::from_millis(16);

/// What a worker tells its parent, or the scripts connected to it.
enum FromWorker {
    Message(Message),
    Error(String),
    Output(Vec<String>),
    Closed,
}

/// What a worker gets: its parent's messages, or a shared worker the ports of the scripts that
/// connect.
enum ToWorker {
    Message(Message),
    Connect(Ends),
}

/// Who a worker tells what it does: its parent, or the scripts connected to a shared worker, each
/// while the link it holds is there.
pub(crate) struct Outbox(Mutex<Vec<(Sender<FromWorker>, Weak<()>)>>);

impl Outbox {
    fn new(to: Sender<FromWorker>, link: &Arc<()>) -> Arc<Self> {
        Arc::new(Self(Mutex::new(vec![(to, Arc::downgrade(link))])))
    }

    fn join(&self, to: Sender<FromWorker>, link: &Arc<()>) {
        self.0.lock().unwrap_or_else(|e| e.into_inner()).push((to, Arc::downgrade(link)));
    }

    /// Tells all of them `event`: whether any are left.
    fn tell(&self, event: impl Fn() -> FromWorker) -> bool {
        let mut list = self.0.lock().unwrap_or_else(|e| e.into_inner());
        list.retain(|(to, link)| link.strong_count() > 0 && to.send(event()).is_ok());
        !list.is_empty()
    }

    /// Whether any of them are left.
    fn is_listened_to(&self) -> bool {
        let mut list = self.0.lock().unwrap_or_else(|e| e.into_inner());
        list.retain(|(_, link)| link.strong_count() > 0);
        !list.is_empty()
    }

    /// Sends `message` to the worker's parent.
    fn post(&self, message: Message) {
        if let Some((to, _)) = self.0.lock().unwrap_or_else(|e| e.into_inner()).first() {
            // A parent that's gone takes nothing.
            let _ = to.send(FromWorker::Message(message));
        }
    }
}

/// A shared worker that runs: its script and name, what it gets, and whom it tells.
struct Shared {
    key: String,
    name: String,
    to: Sender<ToWorker>,
    outbox: Arc<Outbox>,
}

/// The shared workers that run.
static SHARED: Mutex<Vec<Shared>> = Mutex::new(Vec::new());

/// A worker its parent started, or a shared worker the script connected to: its number, the
/// function its `Worker` or `SharedWorker` receives with, its thread's channels, what stops its
/// script, and the link that keeps the worker telling the script what it does.
pub(crate) struct Child<H> {
    number: u32,
    receive: H,
    to: Sender<ToWorker>,
    from: Receiver<FromWorker>,
    interrupt: Arc<Mutex<Option<Interrupt>>>,
    _link: Arc<()>,
    /// A shared worker, which doesn't keep the script running.
    pub(crate) shared: bool,
}

/// What a worker's runtime keeps of whom it tells what it does, the function its global object
/// receives with, and whether the worker's script closed it.
pub(crate) struct Parent<H> {
    outbox: Arc<Outbox>,
    receive: H,
    closing: bool,
}

/// The natives `js/src/worker.js` talks through: `start(url, name, receive)`, which gives the
/// worker's number, `post(number, data, ports, numbers)` and `terminate(number)`,
/// `connect(url, name, port, receive)`, which gives a shared worker's number, and in the worker
/// `self.postMessage(data, ports, numbers)`, `self.close()` and `self.importScripts(...paths)`;
/// `ports` are the `MessagePort`s the message transfers, and `numbers` theirs.
pub(crate) fn natives<E: Engine>(engine: &mut E) -> Result<Vec<(&'static str, E::Handle)>, Error> {
    let natives: [(&str, HostFunction<E::Handle>); 4] =
        [("start", start::<E>), ("post", post_to_worker), ("terminate", terminate), ("connect", connect::<E>)];
    let mut made = natives.into_iter().map(|(name, f)| Ok((name, engine.function(name, f)?))).collect::<Result<Vec<_>, Error>>()?;
    let worker: [(&str, HostFunction<E::Handle>); 3] = [("postMessage", post_to_parent), ("close", close), ("importScripts", import_scripts)];
    let worker = worker.into_iter().map(|(name, f)| Ok((name, engine.function(name, f)?))).collect::<Result<Vec<_>, Error>>()?;
    let self_natives = engine.with_call(|call| {
        let object = call.new_object()?;
        for (name, function) in worker {
            call.set(&object, name, &Value::Js(function))?;
        }
        Ok(object)
    })?;
    made.push(("self", self_natives));
    Ok(made)
}

/// Runs the script at `url` on a thread.
fn start<E: Engine>(call: &mut dyn Call<E::Handle>, _this: &Value<E::Handle>, args: &[Value<E::Handle>]) -> Result<Value<E::Handle>, Error> {
    let path = call.to_string(args.first().unwrap_or(&Value::Undefined))?;
    let name = call.to_string(args.get(1).unwrap_or(&Value::Undefined))?;
    let Some(Value::Js(receive)) = args.get(2) else {
        return Err(Error::Type("Worker: nothing to receive with".into()));
    };
    let (file, directory, language, cache) = {
        let host = call.host()?;
        let host = host.borrow();
        (host.file.as_ref().map(|f| f.to_string_lossy().into_owned()), host.directory.clone(), host.language.clone(), host.cache.clone())
    };
    // A script that isn't there fires an error at the worker, as a page's does.
    let key = crate::modules::locate(&path, file.as_deref(), directory).map_err(|e| e.to_string());
    let (to, inbox) = channel();
    let (sent, from) = channel();
    let link = Arc::new(());
    let outbox = Outbox::new(sent, &link);
    let interrupt = Arc::new(Mutex::new(None));
    spawn::<E>(key, name, Setup { language, cache, ..Setup::default() }, inbox, outbox, interrupt.clone(), false)?;
    add_child(call, Child { number: 0, receive: receive.clone(), to, from, interrupt, _link: link, shared: false })
}

/// Numbers `child` as a worker of the runtime.
fn add_child<H>(call: &mut dyn Call<H>, mut child: Child<H>) -> Result<Value<H>, Error> {
    let host = call.host()?;
    let mut host = host.borrow_mut();
    host.next_child = host.next_child.wrapping_add(1);
    child.number = host.next_child;
    let number = child.number;
    host.children.push(child);
    Ok(Value::Number(f64::from(number)))
}

/// Runs the worker's script on a thread.
fn spawn<E: Engine>(
    key: Result<String, String>,
    name: String,
    setup: Setup,
    inbox: Receiver<ToWorker>,
    outbox: Arc<Outbox>,
    interrupt: Arc<Mutex<Option<Interrupt>>>,
    shared: bool,
) -> Result<(), Error> {
    std::thread::Builder::new()
        .name("scriptographer worker".into())
        .spawn(move || run::<E>(key, &name, setup, &inbox, &outbox, &interrupt, shared))
        .map(|_| ())
        .map_err(|e| Error::Script(format!("Worker: no thread for it: {e}")))
}

/// Connects the script to the shared worker of the script at `url` and its name, which it starts
/// when none runs: the port `args[2]` numbers goes to it.
fn connect<E: Engine>(call: &mut dyn Call<E::Handle>, _this: &Value<E::Handle>, args: &[Value<E::Handle>]) -> Result<Value<E::Handle>, Error> {
    let path = call.to_string(args.first().unwrap_or(&Value::Undefined))?;
    let name = call.to_string(args.get(1).unwrap_or(&Value::Undefined))?;
    let port = call.to_number(args.get(2).unwrap_or(&Value::Undefined))? as u32;
    let Some(Value::Js(receive)) = args.get(3) else {
        return Err(Error::Type("SharedWorker: nothing to receive with".into()));
    };
    let ends = crate::message_port::take(call, port)?;
    let (file, directory, language, cache) = {
        let host = call.host()?;
        let host = host.borrow();
        (host.file.as_ref().map(|f| f.to_string_lossy().into_owned()), host.directory.clone(), host.language.clone(), host.cache.clone())
    };
    let key = crate::modules::locate(&path, file.as_deref(), directory).map_err(|e| e.to_string());
    let (sent, from) = channel();
    let link = Arc::new(());
    let mut shared = SHARED.lock().unwrap_or_else(|e| e.into_inner());
    let running = key.as_ref().ok().and_then(|key| shared.iter().position(|s| s.key == *key && s.name == name));
    let mut ends = Some(ends);
    let mut to = None;
    if let Some(at) = running
        && let Some(Shared { to: running, outbox, .. }) = shared.get(at)
    {
        outbox.join(sent.clone(), &link);
        let running = running.clone();
        match running.send(ToWorker::Connect(ends.take().ok_or_else(|| Error::Script("no port".into()))?)) {
            Ok(()) => to = Some(running),
            // One that ended takes no more: it goes, and another one starts.
            Err(SendError(sent)) => {
                if let ToWorker::Connect(back) = sent {
                    ends = Some(back);
                }
                shared.swap_remove(at);
            }
        }
    }
    let interrupt = Arc::new(Mutex::new(None));
    let to = match (to, ends) {
        (Some(to), _) => to,
        (None, Some(ends)) => {
            let (to, inbox) = channel();
            let outbox = Outbox::new(sent, &link);
            // The first one to connect, before its script runs:
            let _ = to.send(ToWorker::Connect(ends));
            if let Ok(key) = &key {
                shared.push(Shared { key: key.clone(), name: name.clone(), to: to.clone(), outbox: outbox.clone() });
            }
            spawn::<E>(key, name, Setup { language, cache, ..Setup::default() }, inbox, outbox, interrupt.clone(), true)?;
            to
        }
        (None, None) => return Err(Error::Script("SharedWorker: the port went missing".into())),
    };
    drop(shared);
    add_child(call, Child { number: 0, receive: receive.clone(), to, from, interrupt, _link: link, shared: true })
}

/// A worker's thread: runs the script at `key`, then the messages and timers, until it closes or
/// its parent is gone.
fn run<E: Engine>(
    key: Result<String, String>,
    name: &str,
    setup: Setup,
    inbox: &Receiver<ToWorker>,
    outbox: &Arc<Outbox>,
    interrupt: &Arc<Mutex<Option<Interrupt>>>,
    shared: bool,
) {
    // Those it tells may be gone: then nobody listens.
    let report = |message: String| {
        outbox.tell(|| FromWorker::Error(message.clone()));
    };
    let started = (|| -> Result<(Runtime<E>, String), String> {
        let key = key?;
        let source = crate::modules::source(&key, setup.cache.as_deref())?;
        let mut runtime = Runtime::<E>::new().map_err(|e| e.to_string())?;
        let file = url::Url::parse(&key).is_err().then(|| key.clone());
        runtime.set_script(&Setup { file, ..setup }).map_err(|e| e.to_string())?;
        if let (Some(stop), Ok(mut slot)) = (runtime.interrupt(), interrupt.lock()) {
            *slot = Some(stop);
        }
        become_worker(&mut runtime, name, outbox.clone(), shared).map_err(|e| e.to_string())?;
        Ok((runtime, source))
    })();
    let (mut runtime, source) = match started {
        Ok(started) => started,
        Err(e) => {
            report(e);
            outbox.tell(|| FromWorker::Closed);
            return;
        }
    };
    if let Err(e) = runtime.eval(&source) {
        report(e.to_string());
    }
    let clock = Instant::now();
    loop {
        let output = runtime.take_output();
        if !output.is_empty() && !outbox.tell(|| FromWorker::Output(output.clone())) || !outbox.is_listened_to() {
            break;
        }
        if runtime.host.borrow().parent.as_ref().is_none_or(|p| p.closing) {
            break;
        }
        match inbox.recv_timeout(FRAME) {
            Ok(sent) => {
                if let Err(e) = deliver(&mut runtime, sent) {
                    report(e.to_string());
                }
            }
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => break,
        }
        if let Err(e) = runtime.run_timers(clock.elapsed().as_secs_f64() * 1000.0) {
            report(e.to_string());
        }
    }
    outbox.tell(|| FromWorker::Closed);
}

/// Gives the worker's global object what a worker's has (`setupWorker()` in `js/src/worker.js`).
fn become_worker<E: Engine>(runtime: &mut Runtime<E>, name: &str, outbox: Arc<Outbox>, shared: bool) -> Result<(), Error> {
    runtime.engine.with_call(|call| {
        let receive = crate::call_bundle(call, "setupWorker", &[Value::String(name.to_owned()), Value::Bool(shared)])?;
        let receive = crate::handle(receive, "setupWorker()")?;
        call.host()?.borrow_mut().parent = Some(Parent { outbox, receive, closing: false });
        Ok(())
    })
}

/// What the worker got, to its global object: a message from the parent, as `message`, or
/// `messageerror` when it can't be made in this realm; or the port of a script that connected.
fn deliver<E: Engine>(runtime: &mut Runtime<E>, sent: ToWorker) -> Result<(), Error> {
    runtime.engine.with_call(|call| {
        let receive_with = call.host()?.borrow().parent.as_ref().map(|p| p.receive.clone()).ok_or_else(|| Error::Script("not a worker".into()))?;
        let received = match sent {
            ToWorker::Message(sent) => receive(call, sent)?,
            ToWorker::Connect(ends) => {
                let number = crate::message_port::add(call, ends)?;
                crate::call_bundle(call, "makePort", &[Value::Number(f64::from(number))])?
            }
        };
        call.call(&receive_with, &Value::Undefined, &[received]).map(|_| ())
    })
}

/// The worker's `postMessage(data, ports, numbers)`.
fn post_to_parent<H: Clone>(call: &mut dyn Call<H>, _this: &Value<H>, args: &[Value<H>]) -> Result<Value<H>, Error> {
    let sent = message(call, args)?;
    if let Some(parent) = call.host()?.borrow().parent.as_ref() {
        parent.outbox.post(sent);
    }
    Ok(Value::Undefined)
}

/// The worker's `close()`: it ends once its script returns.
fn close<H: Clone>(call: &mut dyn Call<H>, _this: &Value<H>, _args: &[Value<H>]) -> Result<Value<H>, Error> {
    if let Some(parent) = call.host()?.borrow_mut().parent.as_mut() {
        parent.closing = true;
    }
    Ok(Value::Undefined)
}

/// The worker's `importScripts(...paths)`: runs each script, in order, as a classic script.
fn import_scripts<H: Clone>(call: &mut dyn Call<H>, _this: &Value<H>, args: &[Value<H>]) -> Result<Value<H>, Error> {
    let (file, directory, cache) = {
        let host = call.host()?;
        let host = host.borrow();
        (host.file.as_ref().map(|f| f.to_string_lossy().into_owned()), host.directory.clone(), host.cache.clone())
    };
    let eval = crate::global_class(call, "eval")?;
    for path in args {
        let path = call.to_string(path)?;
        let key = crate::modules::locate(&path, file.as_deref(), directory.clone()).map_err(|e| Error::Dom("NetworkError", e.to_string()))?;
        let source =
            crate::modules::source(&key, cache.as_deref()).map_err(|e| Error::Dom("NetworkError", format!("importScripts '{path}': {e}")))?;
        // Called as itself, `eval` runs in the global scope, as a classic script does.
        call.call(&eval, &Value::Undefined, &[Value::String(source)])?;
    }
    Ok(Value::Undefined)
}

/// The worker `args[0]` numbers.
fn number<H>(call: &mut dyn Call<H>, args: &[Value<H>]) -> Result<f64, Error> {
    call.to_number(args.first().unwrap_or(&Value::Undefined))
}

/// The parent's `worker.postMessage(data, ports, numbers)`.
fn post_to_worker<H: Clone>(call: &mut dyn Call<H>, _this: &Value<H>, args: &[Value<H>]) -> Result<Value<H>, Error> {
    let number = number(call, args)?;
    let sent = message(call, args.get(1..).unwrap_or_default())?;
    if let Some(child) = call.host()?.borrow().children.iter().find(|c| f64::from(c.number) == number) {
        // A worker that ended takes nothing, as in browsers.
        let _ = child.to.send(ToWorker::Message(sent));
    }
    Ok(Value::Undefined)
}

/// `worker.terminate()`: stops its script and ends it.
fn terminate<H: Clone>(call: &mut dyn Call<H>, _this: &Value<H>, args: &[Value<H>]) -> Result<Value<H>, Error> {
    let number = number(call, args)?;
    let child = {
        let host = call.host()?;
        let mut host = host.borrow_mut();
        let at = host.children.iter().position(|c| f64::from(c.number) == number);
        at.map(|at| host.children.swap_remove(at))
    };
    if let Some(child) = child
        && let Ok(slot) = child.interrupt.lock()
        && let Some(stop) = slot.as_ref()
    {
        stop();
    }
    Ok(Value::Undefined)
}

/// Hands what the workers sent to their `Worker`s, on the parent's turn, and passes on their
/// output.
pub(crate) fn poll<H: Clone>(call: &mut dyn Call<H>) -> Result<(), Error> {
    let arrived: Vec<(u32, H, Vec<FromWorker>)> = call
        .host()?
        .borrow()
        .children
        .iter()
        .map(|child| (child.number, child.receive.clone(), std::iter::from_fn(|| child.from.try_recv().ok()).collect()))
        .filter(|(_, _, sent): &(u32, H, Vec<FromWorker>)| !sent.is_empty())
        .collect();
    for (number, receive, sent) in arrived {
        for sent in sent {
            let sent = match sent {
                FromWorker::Output(lines) => {
                    call.host()?.borrow_mut().output.extend(lines);
                    continue;
                }
                FromWorker::Closed => {
                    call.host()?.borrow_mut().children.retain(|c| c.number != number);
                    break;
                }
                FromWorker::Message(sent) => crate::message_port::receive(call, sent)?,
                FromWorker::Error(message) => {
                    let error = call.new_object()?;
                    call.set(&error, "type", &Value::String("error".into()))?;
                    call.set(&error, "message", &Value::String(message))?;
                    Value::Js(error)
                }
            };
            call.call(&receive, &Value::Undefined, &[sent])?;
        }
    }
    Ok(())
}
