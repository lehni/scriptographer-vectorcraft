//! The connections of `EventSource` outside a browser (`js/src/event-source.js`): a connection's
//! thread requests the stream (`ureq`), reads its events as the HTML standard parses them, and
//! once the stream ends or breaks, connects again after the reconnection time, with the last
//! event's id. What it reads goes to the script on its turn ([`poll`]). An open connection keeps
//! the script running. ureq can't stop a read, so a closed connection's thread ends once the
//! server sends again or the stream ends.

use std::io::Read;
use std::sync::mpsc::{Receiver, Sender, channel};
use std::sync::{Arc, Weak};
use std::time::Duration;

use crate::{Call, Engine, Error, HostFunction, Value};

/// How long a connection waits before it connects again, unless the server says otherwise.
const RECONNECTION_TIME: u64 = 3000;
/// How often a waiting connection looks whether the script still has it.
const WAIT_STEP: Duration = Duration::from_millis(100);
/// The most of an event that's kept while it's read, in bytes: more fails the connection.
const MOST: usize = 16 * 1024 * 1024;

/// What a connection's thread tells the script.
enum Incoming {
    /// Connected, to the stream at this URL (after redirects).
    Open(String),
    /// An event of the stream.
    Event { kind: String, data: String, id: String },
    /// The stream ended or broke: the thread connects again.
    Reconnecting,
    /// The stream can't be read, for this reason: the thread ended.
    Failed(String),
}

/// A script's connection: its number, the function it receives with, its thread's channel, and
/// the link the thread holds weakly, which ends it once the script lets the connection go.
pub(crate) struct Connection<H> {
    number: u32,
    receive: H,
    incoming: Receiver<Incoming>,
    _link: Arc<()>,
}

/// The natives `js/src/event-source.js` talks through: `open(url, receive)`, which gives the
/// connection's number, and `close(number)`.
pub(crate) fn natives<E: Engine>(engine: &mut E) -> Result<Vec<(&'static str, E::Handle)>, Error> {
    let natives: [(&str, HostFunction<E::Handle>); 2] = [("open", open), ("close", close)];
    natives.into_iter().map(|(name, f)| Ok((name, engine.function(name, f)?))).collect()
}

/// Connects to `url` on a thread.
fn open<H: Clone>(call: &mut dyn Call<H>, _this: &Value<H>, args: &[Value<H>]) -> Result<Value<H>, Error> {
    let url = call.to_string(args.first().unwrap_or(&Value::Undefined))?;
    let Some(Value::Js(receive)) = args.get(1) else {
        return Err(Error::Type("EventSource: nothing to receive with".into()));
    };
    let (sent, incoming) = channel();
    let link = Arc::new(());
    let held = Arc::downgrade(&link);
    std::thread::Builder::new()
        .name("scriptographer event source".into())
        .spawn(move || run(&url, &held, &sent))
        .map_err(|e| Error::Script(format!("EventSource: no thread for it: {e}")))?;
    let host = call.host()?;
    let mut host = host.borrow_mut();
    host.next_event_source = host.next_event_source.wrapping_add(1);
    let number = host.next_event_source;
    host.event_sources.push(Connection { number, receive: receive.clone(), incoming, _link: link });
    Ok(Value::Number(f64::from(number)))
}

/// `source.close()`: the script receives nothing from then on, and the thread ends.
fn close<H: Clone>(call: &mut dyn Call<H>, _this: &Value<H>, args: &[Value<H>]) -> Result<Value<H>, Error> {
    let number = call.to_number(args.first().unwrap_or(&Value::Undefined))?;
    call.host()?.borrow_mut().event_sources.retain(|c| f64::from(c.number) != number);
    Ok(Value::Undefined)
}

/// A connection's thread: reads the stream at `url`, and connects again once it ends, while the
/// script holds the connection (`link`).
fn run(url: &str, link: &Weak<()>, incoming: &Sender<Incoming>) {
    let mut stream = Stream::default();
    loop {
        if let Err(Fatal(reason)) = read(url, link, incoming, &mut stream) {
            // The script may have let the connection go: then nobody listens.
            let _ = incoming.send(Incoming::Failed(reason));
            return;
        }
        if link.upgrade().is_none() || incoming.send(Incoming::Reconnecting).is_err() {
            return;
        }
        let mut waited = Duration::ZERO;
        while waited < Duration::from_millis(stream.reconnection_time) {
            if link.upgrade().is_none() {
                return;
            }
            std::thread::sleep(WAIT_STEP);
            waited += WAIT_STEP;
        }
    }
}

/// Why a connection can't go on: it's not an event stream, or it can't be read.
struct Fatal(String);

/// What a connection keeps of its stream across reconnections, and the event it's reading.
struct Stream {
    reconnection_time: u64,
    last_event_id: String,
    kind: String,
    data: String,
    id: String,
    /// The line read so far, and whether the last byte ended one with a CR, which a LF after it
    /// belongs to.
    line: Vec<u8>,
    after_cr: bool,
}

impl Default for Stream {
    fn default() -> Self {
        Self {
            reconnection_time: RECONNECTION_TIME,
            last_event_id: String::new(),
            kind: String::new(),
            data: String::new(),
            id: String::new(),
            line: Vec::new(),
            after_cr: false,
        }
    }
}

/// Requests the stream and hands its events on, until it ends (`Ok`) or breaks (`Ok` too, so the
/// thread connects again), or what it got is no event stream.
fn read(url: &str, link: &Weak<()>, incoming: &Sender<Incoming>, stream: &mut Stream) -> Result<(), Fatal> {
    if !url.starts_with("https://") && !url.starts_with("http://") {
        return Err(Fatal(format!("only http: and https: URLs, not '{url}'")));
    }
    let agent: ureq::Agent = ureq::Agent::config_builder().http_status_as_error(false).build().into();
    let mut request = agent.get(url).header("Accept", "text/event-stream").header("Cache-Control", "no-store");
    if !stream.last_event_id.is_empty() {
        request = request.header("Last-Event-ID", &stream.last_event_id);
    }
    let response = match request.call() {
        Ok(response) => response,
        // A URL ureq can't request at all fails; one that doesn't answer is tried again.
        Err(e @ (ureq::Error::BadUri(_) | ureq::Error::Http(_))) => return Err(Fatal(e.to_string())),
        Err(_) => return Ok(()),
    };
    let status = response.status().as_u16();
    if status != 200 {
        return Err(Fatal(format!("the server answered {status}")));
    }
    let kind = response.headers().get("Content-Type").and_then(|t| t.to_str().ok()).unwrap_or_default();
    if kind.split(';').next().map(str::trim) != Some("text/event-stream") {
        return Err(Fatal(format!("not an event stream, but '{kind}'")));
    }
    let final_url = ureq::ResponseExt::get_uri(&response).to_string();
    if incoming.send(Incoming::Open(final_url)).is_err() {
        return Ok(());
    }
    // A new stream starts with a new line and event; a BOM at its start is no part of it.
    (stream.line, stream.after_cr, stream.kind, stream.data, stream.id) = (Vec::new(), false, String::new(), String::new(), String::new());
    let mut started = false;
    let mut body = response.into_body().into_reader();
    let mut buffer = [0; 16 * 1024];
    loop {
        let Ok(count) = body.read(&mut buffer) else {
            return Ok(());
        };
        if count == 0 || link.upgrade().is_none() {
            return Ok(());
        }
        let mut bytes = buffer.get(..count).unwrap_or_default();
        if !started {
            started = true;
            bytes = bytes.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(bytes);
        }
        for &byte in bytes {
            let after_cr = std::mem::replace(&mut stream.after_cr, byte == b'\r');
            match byte {
                b'\n' if after_cr => {}
                b'\r' | b'\n' => {
                    let line = std::mem::take(&mut stream.line);
                    if let Some(event) = stream.line_read(&String::from_utf8_lossy(&line))
                        && incoming.send(event).is_err()
                    {
                        return Ok(());
                    }
                }
                _ => stream.line.push(byte),
            }
            if stream.line.len() + stream.data.len() > MOST {
                return Err(Fatal("an event is too long".into()));
            }
        }
    }
}

impl Stream {
    /// Takes in a line of the stream: the event it completes, if any.
    fn line_read(&mut self, line: &str) -> Option<Incoming> {
        if line.is_empty() {
            return self.dispatch();
        }
        if line.starts_with(':') {
            return None;
        }
        let (field, value) = line.split_once(':').map_or((line, ""), |(field, value)| (field, value.strip_prefix(' ').unwrap_or(value)));
        match field {
            "event" => self.kind = value.to_owned(),
            "data" => {
                self.data.push_str(value);
                self.data.push('\n');
            }
            "id" if !value.contains('\0') => self.id = value.to_owned(),
            "retry" if !value.is_empty() && value.bytes().all(|b| b.is_ascii_digit()) => {
                self.reconnection_time = value.parse().unwrap_or(self.reconnection_time);
            }
            _ => {}
        }
        None
    }

    /// The event read, at an empty line: none without data.
    fn dispatch(&mut self) -> Option<Incoming> {
        self.last_event_id.clone_from(&self.id);
        let kind = std::mem::take(&mut self.kind);
        let mut data = std::mem::take(&mut self.data);
        if data.is_empty() {
            return None;
        }
        data.pop();
        let kind = if kind.is_empty() { "message".to_owned() } else { kind };
        Some(Incoming::Event { kind, data, id: self.last_event_id.clone() })
    }
}

/// Hands what the connections' threads read to their scripts' `EventSource`s (`{ state, … }`), on
/// the script's turn.
pub(crate) fn poll<H: Clone>(call: &mut dyn Call<H>) -> Result<(), Error> {
    let arrived: Vec<(u32, H, Vec<Incoming>)> = call
        .host()?
        .borrow()
        .event_sources
        .iter()
        .map(|c| (c.number, c.receive.clone(), std::iter::from_fn(|| c.incoming.try_recv().ok()).collect::<Vec<_>>()))
        .filter(|(_, _, incoming)| !incoming.is_empty())
        .collect();
    for (number, receive, incoming) in arrived {
        for incoming in incoming {
            // A listener may have closed it meanwhile.
            if !call.host()?.borrow().event_sources.iter().any(|c| c.number == number) {
                break;
            }
            let fields = match incoming {
                Incoming::Open(url) => vec![("state", Value::String("open".into())), ("url", Value::String(url))],
                Incoming::Event { kind, data, id } => vec![
                    ("state", Value::String("event".into())),
                    ("type", Value::String(kind)),
                    ("data", Value::String(data)),
                    ("lastEventId", Value::String(id)),
                ],
                Incoming::Reconnecting => vec![("state", Value::String("reconnecting".into()))],
                Incoming::Failed(reason) => {
                    call.host()?.borrow_mut().event_sources.retain(|c| c.number != number);
                    vec![("state", Value::String("failed".into())), ("reason", Value::String(reason))]
                }
            };
            let object = call.new_object()?;
            for (key, value) in fields {
                call.set(&object, key, &value)?;
            }
            call.call(&receive, &Value::Undefined, &[Value::Js(object)])?;
        }
    }
    Ok(())
}
