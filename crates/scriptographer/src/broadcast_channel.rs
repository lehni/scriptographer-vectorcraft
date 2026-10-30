//! `BroadcastChannel` outside a browser (core's `src/broadcast-channel.js`). All of the app's scripts
//! and their workers are of one origin: a message goes to every other channel of its name, in any
//! runtime, as structured serialization keeps it, and arrives on the receiver's turn ([`poll`]),
//! in the order the messages were posted, and to the channels of one in the order they were
//! opened.

use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{Receiver, Sender, channel};

use crate::clone::{Data, serialize_with};
use crate::message_port::{Message, receive};
use crate::{Call, Engine, Error, HostFunction, Value};

/// The open channels of every runtime, in the order they were opened.
static CHANNELS: Mutex<Vec<Open>> = Mutex::new(Vec::new());
/// The id the next channel gets, and the number the next message gets.
static NEXT_ID: AtomicU64 = AtomicU64::new(0);
static NEXT_MESSAGE: AtomicU64 = AtomicU64::new(0);

/// An open channel, as every runtime finds it: its id, its name, and what it receives from, each
/// message with its number.
struct Open {
    id: u64,
    name: String,
    to: Sender<(u64, Data)>,
}

/// A channel of the runtime: its number, its id among all, and what it receives with.
pub(crate) struct Channel<H> {
    number: u32,
    id: u64,
    from: Receiver<(u64, Data)>,
    receive: H,
}

/// The natives core's `src/broadcast-channel.js` talks through: `open(name, receive)`, which gives
/// the new channel's number, `post(number, message)` and `close(number)`.
pub(crate) fn natives<E: Engine>(engine: &mut E) -> Result<Vec<(&'static str, E::Handle)>, Error> {
    let natives: [(&str, HostFunction<E::Handle>); 3] = [("open", open), ("post", post), ("close", close)];
    natives.into_iter().map(|(name, f)| Ok((name, engine.function(name, f)?))).collect()
}

/// `new BroadcastChannel(name)`: what's posted to `name` from then on goes to `receive`.
fn open<H: Clone>(call: &mut dyn Call<H>, _this: &Value<H>, args: &[Value<H>]) -> Result<Value<H>, Error> {
    let name = call.to_string(args.first().unwrap_or(&Value::Undefined))?;
    let Some(Value::Js(receive)) = args.get(1) else {
        return Err(Error::Type("BroadcastChannel: nothing to receive with".into()));
    };
    let (to, from) = channel();
    let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
    CHANNELS.lock().unwrap_or_else(|e| e.into_inner()).push(Open { id, name, to });
    let host = call.host()?;
    let mut host = host.borrow_mut();
    host.next_channel = host.next_channel.wrapping_add(1);
    let number = host.next_channel;
    host.channels.push(Channel { number, id, from, receive: receive.clone() });
    Ok(Value::Number(f64::from(number)))
}

/// The channel `args[0]` numbers, while it's open.
fn id<H>(call: &mut dyn Call<H>, args: &[Value<H>]) -> Result<Option<u64>, Error> {
    let number = call.to_number(args.first().unwrap_or(&Value::Undefined))? as u32;
    Ok(call.host()?.borrow().channels.iter().find(|c| c.number == number).map(|c| c.id))
}

/// `channel.postMessage(message)`: to the other channels of its name. Those of runtimes that are
/// gone take nothing, and go.
fn post<H: Clone>(call: &mut dyn Call<H>, _this: &Value<H>, args: &[Value<H>]) -> Result<Value<H>, Error> {
    let Some(id) = id(call, args)? else {
        return Ok(Value::Undefined);
    };
    let data = serialize_with(call, args.get(1).unwrap_or(&Value::Undefined), &Value::Undefined)?;
    let message = NEXT_MESSAGE.fetch_add(1, Ordering::Relaxed);
    let mut channels = CHANNELS.lock().unwrap_or_else(|e| e.into_inner());
    let name = channels.iter().find(|open| open.id == id).map(|open| open.name.clone());
    channels.retain(|open| open.id == id || Some(&open.name) != name.as_ref() || open.to.send((message, data.clone())).is_ok());
    Ok(Value::Undefined)
}

/// `channel.close()`: it receives nothing from then on.
fn close<H: Clone>(call: &mut dyn Call<H>, _this: &Value<H>, args: &[Value<H>]) -> Result<Value<H>, Error> {
    if let Some(id) = id(call, args)? {
        CHANNELS.lock().unwrap_or_else(|e| e.into_inner()).retain(|open| open.id != id);
        call.host()?.borrow_mut().channels.retain(|c| c.id != id);
    }
    Ok(Value::Undefined)
}

/// Hands what arrived at the runtime's channels to their `BroadcastChannel`s, on its turn.
pub(crate) fn poll<H: Clone>(call: &mut dyn Call<H>) -> Result<(), Error> {
    let mut arrived: Vec<(u64, H, Data)> = call
        .host()?
        .borrow()
        .channels
        .iter()
        .flat_map(|channel| std::iter::from_fn(|| channel.from.try_recv().ok()).map(|(message, data)| (message, channel.receive.clone(), data)))
        .collect();
    // Stable, so the channels of a message keep their order:
    arrived.sort_by_key(|(message, ..)| *message);
    for (_, receive, data) in arrived {
        let received = self::receive(call, Message { data, ports: Vec::new() })?;
        call.call(&receive, &Value::Undefined, &[received])?;
    }
    Ok(())
}
