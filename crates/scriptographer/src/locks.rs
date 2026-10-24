//! `navigator.locks` outside a browser (`js/src/locks.js`): the Web Locks of all of the app's
//! scripts and their workers, as of one origin. A lock that's free is granted at once; one that
//! frees up later goes to the next request for it, on the requesting script's turn ([`poll`]).
//! A runtime that ends lets go of its locks and requests ([`forget`]).

use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{Receiver, Sender, channel};

use crate::{Call, Engine, Error, HostFunction, Value};

/// The locks held, and the requests waiting for them, in the order they came.
static MANAGER: Mutex<Manager> = Mutex::new(Manager { held: Vec::new(), waiting: Vec::new() });
/// The number the next request gets, and the next runtime.
static NEXT_REQUEST: AtomicU64 = AtomicU64::new(1);
static NEXT_CLIENT: AtomicU64 = AtomicU64::new(1);

struct Manager {
    held: Vec<Request>,
    waiting: Vec<Request>,
}

/// A request for the lock `name`: its number, whether it's exclusive, the runtime it's from, and
/// what that runtime hears of it with.
struct Request {
    id: u64,
    name: String,
    exclusive: bool,
    client: u64,
    to: Sender<Event>,
}

/// What a runtime hears of its requests.
enum Event {
    Granted(u64),
    Stolen(u64),
}

/// A runtime's side of the locks: its number, what it hears of its requests, and its requests,
/// each with the function its script receives with and whether it's granted.
pub(crate) struct Locks<H> {
    client: u64,
    to: Sender<Event>,
    from: Receiver<Event>,
    requests: Vec<(u64, H, bool)>,
}

impl<H> Default for Locks<H> {
    fn default() -> Self {
        let (to, from) = channel();
        Self { client: NEXT_CLIENT.fetch_add(1, Ordering::Relaxed), to, from, requests: Vec::new() }
    }
}

impl<H> Locks<H> {
    /// Whether a request waits for its lock, which keeps the script running.
    pub(crate) fn is_waiting(&self) -> bool {
        self.requests.iter().any(|(_, _, granted)| !granted)
    }
}

impl Manager {
    /// Whether the lock `name` can be granted as `exclusive` or shared, with the requests waiting
    /// before `ahead` of it.
    fn is_free(&self, name: &str, exclusive: bool, ahead: &[Request]) -> bool {
        let conflicts = |r: &Request| r.name == name && (exclusive || r.exclusive);
        !self.held.iter().any(conflicts) && !ahead.iter().any(|r| r.name == name)
    }

    /// Grants the requests waiting that can be, in their order, and tells their runtimes.
    fn grant(&mut self) {
        let mut at = 0;
        while let Some(request) = self.waiting.get(at) {
            if self.is_free(&request.name, request.exclusive, self.waiting.get(..at).unwrap_or_default()) {
                let request = self.waiting.remove(at);
                // A runtime that's gone forgot its requests already.
                let _ = request.to.send(Event::Granted(request.id));
                self.held.push(request);
            } else {
                at += 1;
            }
        }
    }
}

fn manager() -> std::sync::MutexGuard<'static, Manager> {
    MANAGER.lock().unwrap_or_else(|e| e.into_inner())
}

/// The natives `js/src/locks.js` talks through: `request(name, exclusive, ifAvailable, steal,
/// receive)`, which gives the request's number and whether it's `granted`, `waiting` or
/// `unavailable`, `release(number)`, `cancel(number)` and `query()`. What a request hears later,
/// `granted` or `stolen`, goes to `receive()`.
pub(crate) fn natives<E: Engine>(engine: &mut E) -> Result<Vec<(&'static str, E::Handle)>, Error> {
    let natives: [(&str, HostFunction<E::Handle>); 4] = [("request", request), ("release", release), ("cancel", release), ("query", query)];
    natives.into_iter().map(|(name, f)| Ok((name, engine.function(name, f)?))).collect()
}

fn request<H: Clone>(call: &mut dyn Call<H>, _this: &Value<H>, args: &[Value<H>]) -> Result<Value<H>, Error> {
    let name = call.to_string(args.first().unwrap_or(&Value::Undefined))?;
    let flag = |i: usize| matches!(args.get(i), Some(Value::Bool(true)));
    let (exclusive, if_available, steal) = (flag(1), flag(2), flag(3));
    let Some(Value::Js(receive)) = args.get(4) else {
        return Err(Error::Type("locks: nothing to receive with".into()));
    };
    let (client, to) = {
        let host = call.host()?;
        let host = host.borrow();
        (host.locks.client, host.locks.to.clone())
    };
    let id = NEXT_REQUEST.fetch_add(1, Ordering::Relaxed);
    let request = Request { id, name, exclusive, client, to };
    let state = {
        let mut manager = manager();
        if steal {
            for stolen in manager.held.extract_if(.., |r| r.name == request.name) {
                let _ = stolen.to.send(Event::Stolen(stolen.id));
            }
        }
        // One that steals the lock gets it ahead of those waiting.
        if steal || manager.is_free(&request.name, exclusive, &manager.waiting) {
            manager.held.push(request);
            "granted"
        } else if if_available {
            "unavailable"
        } else {
            manager.waiting.push(request);
            "waiting"
        }
    };
    if state != "unavailable" {
        call.host()?.borrow_mut().locks.requests.push((id, receive.clone(), state == "granted"));
    }
    let id = Value::Number(id as f64);
    Ok(Value::Js(call.new_array(&[id, Value::String(state.into())])?))
}

/// `release(number)` once the request's callback is done, and `cancel(number)` once its signal
/// aborted: the lock goes to the next request for it.
fn release<H>(call: &mut dyn Call<H>, _this: &Value<H>, args: &[Value<H>]) -> Result<Value<H>, Error> {
    let id = call.to_number(args.first().unwrap_or(&Value::Undefined))? as u64;
    call.host()?.borrow_mut().locks.requests.retain(|(other, ..)| *other != id);
    let mut manager = manager();
    manager.held.retain(|r| r.id != id);
    manager.waiting.retain(|r| r.id != id);
    manager.grant();
    Ok(Value::Undefined)
}

/// `query()`: the locks held and the requests waiting, as `{ held, pending }` of `{ name, mode,
/// clientId }`.
fn query<H: Clone>(call: &mut dyn Call<H>, _this: &Value<H>, _args: &[Value<H>]) -> Result<Value<H>, Error> {
    let (held, waiting): (Vec<_>, Vec<_>) = {
        let manager = manager();
        let list = |list: &[Request]| list.iter().map(|r| (r.name.clone(), r.exclusive, r.client)).collect::<Vec<_>>();
        (list(&manager.held), list(&manager.waiting))
    };
    let state = call.new_object()?;
    for (key, list) in [("held", held), ("pending", waiting)] {
        let mut infos = Vec::with_capacity(list.len());
        for (name, exclusive, client) in list {
            let info = call.new_object()?;
            call.set(&info, "name", &Value::String(name))?;
            call.set(&info, "mode", &Value::String(if exclusive { "exclusive" } else { "shared" }.into()))?;
            call.set(&info, "clientId", &Value::String(client.to_string()))?;
            infos.push(Value::Js(info));
        }
        let infos = call.new_array(&infos)?;
        call.set(&state, key, &Value::Js(infos))?;
    }
    Ok(Value::Js(state))
}

/// Tells the script what its requests heard, on its turn.
pub(crate) fn poll<H: Clone>(call: &mut dyn Call<H>) -> Result<(), Error> {
    let heard: Vec<(H, &str)> = {
        let host = call.host()?;
        let mut host = host.borrow_mut();
        let locks = &mut host.locks;
        let events: Vec<Event> = locks.from.try_iter().collect();
        events
            .into_iter()
            .filter_map(|event| {
                let (id, state) = match event {
                    Event::Granted(id) => (id, "granted"),
                    Event::Stolen(id) => (id, "stolen"),
                };
                let request = locks.requests.iter_mut().find(|(other, ..)| *other == id)?;
                request.2 = true;
                Some((request.1.clone(), state))
            })
            .collect()
    };
    for (receive, state) in heard {
        call.call(&receive, &Value::Undefined, &[Value::String(state.into())])?;
    }
    Ok(())
}

/// Lets go of the locks and requests of the runtime whose locks are `locks`, once it ends.
pub(crate) fn forget<H>(locks: &Locks<H>) {
    let mut manager = manager();
    manager.held.retain(|r| r.client != locks.client);
    manager.waiting.retain(|r| r.client != locks.client);
    manager.grant();
}
