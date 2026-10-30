//! The requests of `fetch()` outside a browser (core's `src/fetch.js`), which the runtime sends: each on
//! a thread of its own (`ureq`, HTTPS through rustls). On the script's turns ([`poll`]), the script
//! gets the response's head, then its body as it arrives. A request out keeps the script running,
//! until its body ended or the script cancelled it.

use std::io::Read;
use std::sync::mpsc::{Receiver, Sender, TryRecvError};
use std::time::Duration;

use crate::{Call, Engine, Error, HostFunction, Value, handle};

/// The largest response body read, in bytes.
const MOST: u64 = 512 * 1024 * 1024;

/// How long a request waits to reach its server.
const CONNECT: Duration = Duration::from_secs(30);
/// How long a request waits for the server's answer, as browsers do, and an import for its body.
const WAIT: Duration = Duration::from_secs(300);

/// A request on its thread: its number, and what the script receives its response with.
pub(crate) struct Pending<H> {
    number: u32,
    events: Receiver<Event>,
    receive: H,
}

/// What a request's thread tells the script: the response's head (an [`Answer`] without a body),
/// then its body, a part at a time, until it ends or fails.
enum Event {
    Head(Answer),
    Part(Vec<u8>),
    End,
    Failed(String),
}

/// How much of a body is read at a time, at most.
const PART: usize = 64 * 1024;

/// A response as its thread received it.
pub(crate) struct Answer {
    pub status: u16,
    status_text: String,
    url: String,
    redirected: bool,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

/// The natives core's `src/fetch.js` talks through: `request(method, url, headers, body, follow,
/// receive)`, which gives the request's number, and `cancel(number)`. What the server answers
/// goes to `receive()`: the response's head (`{ status, statusText, url, redirected, headers }`),
/// then its body a part at a time, as `Uint8Array`s, and `null` at its end; or why the request
/// failed, as a string.
pub(crate) fn natives<E: Engine>(engine: &mut E) -> Result<Vec<(&'static str, E::Handle)>, Error> {
    let natives: [(&str, HostFunction<E::Handle>); 2] = [("request", request), ("cancel", cancel)];
    natives.into_iter().map(|(name, f)| Ok((name, engine.function(name, f)?))).collect()
}

fn request<H: Clone>(call: &mut dyn Call<H>, _this: &Value<H>, args: &[Value<H>]) -> Result<Value<H>, Error> {
    let text = |call: &mut dyn Call<H>, index: usize| call.to_string(args.get(index).unwrap_or(&Value::Undefined));
    let (method_name, url) = (text(call, 0)?, text(call, 1)?);
    let headers = match args.get(2) {
        Some(Value::Js(list)) => pairs(call, list)?,
        _ => Vec::new(),
    };
    let body = match args.get(3) {
        Some(Value::Js(bytes)) => Some(call.bytes(bytes)?),
        _ => None,
    };
    let follow = matches!(args.get(4), Some(Value::Bool(true)));
    let Some(Value::Js(receive)) = args.get(5).cloned() else {
        return Err(Error::Type("fetch: nothing to receive the response with".into()));
    };
    let (send, events) = std::sync::mpsc::channel();
    if url.starts_with("https://") || url.starts_with("http://") {
        let failed = send.clone();
        let thread = std::thread::Builder::new().name("scriptographer fetch".into());
        if let Err(e) = thread.spawn(move || stream_on_thread(&method_name, &url, &headers, body, follow, &send)) {
            let _ = failed.send(Event::Failed(format!("the request couldn't start: {e}")));
        }
    } else {
        // The script hears of it on its next turn, as of any failure.
        let _ = send.send(Event::Failed(format!("only http: and https: URLs, not '{url}'")));
    }
    let host = call.host()?;
    let mut host = host.borrow_mut();
    host.next_fetch = host.next_fetch.wrapping_add(1);
    let number = host.next_fetch;
    host.fetches.push(Pending { number, events, receive });
    Ok(Value::Number(f64::from(number)))
}

/// `cancel(number)`: the script hears nothing more of the request, and its thread ends once it
/// reads on.
fn cancel<H>(call: &mut dyn Call<H>, _this: &Value<H>, args: &[Value<H>]) -> Result<Value<H>, Error> {
    let number = call.to_number(args.first().unwrap_or(&Value::Undefined))?;
    call.host()?.borrow_mut().fetches.retain(|f| f64::from(f.number) != number);
    Ok(Value::Undefined)
}

/// The `[name, value]` pairs of `list`.
fn pairs<H: Clone>(call: &mut dyn Call<H>, list: &H) -> Result<Vec<(String, String)>, Error> {
    let length = call.get(list, "length")?;
    let length = call.to_number(&length)?;
    let mut pairs = Vec::new();
    for i in 0..(if length.is_finite() { length.max(0.0) as usize } else { 0 }) {
        let pair = handle(call.get(list, &i.to_string())?, "header")?;
        let (name, value) = (call.get(&pair, "0")?, call.get(&pair, "1")?);
        pairs.push((call.to_string(&name)?, call.to_string(&value)?));
    }
    Ok(pairs)
}

/// `GET url` with `headers`, on this thread.
pub(crate) fn get(url: &str, headers: &[(String, String)]) -> Result<Answer, String> {
    request_on_thread("GET", url, headers, None, true)
}

/// The request, on this thread, its body read whole within [`WAIT`].
fn request_on_thread(method: &str, url: &str, headers: &[(String, String)], body: Option<Vec<u8>>, follow: bool) -> Result<Answer, String> {
    let (mut answer, mut response) = send(method, url, headers, body, Some(WAIT), follow)?;
    answer.body = response.body_mut().with_config().limit(MOST).read_to_vec().map_err(|e| e.to_string())?;
    Ok(answer)
}

/// The request, on its thread, which tells the script of the response's head, then of its body as
/// it arrives, until the script no longer listens.
fn stream_on_thread(method: &str, url: &str, headers: &[(String, String)], body: Option<Vec<u8>>, follow: bool, events: &Sender<Event>) {
    // Nobody to tell once the script is gone.
    let (answer, response) = match send(method, url, headers, body, None, follow) {
        Ok(sent) => sent,
        Err(message) => {
            let _ = events.send(Event::Failed(message));
            return;
        }
    };
    if events.send(Event::Head(answer)).is_err() {
        return;
    }
    let mut body = response.into_body().into_with_config().limit(MOST).reader();
    let mut part = vec![0; PART];
    loop {
        let event = match body.read(&mut part) {
            Ok(0) => Event::End,
            Ok(count) => Event::Part(part.get(..count).unwrap_or_default().to_vec()),
            Err(e) => Event::Failed(e.to_string()),
        };
        let done = !matches!(event, Event::Part(_));
        if events.send(event).is_err() || done {
            return;
        }
    }
}

/// Sends the request: the response's head, as an [`Answer`] without a body, and the response. It
/// fails when the server can't be reached within [`CONNECT`], or doesn't answer within [`WAIT`]; its
/// body may take as long as it takes (a stream of events), or up to `body_within`.
fn send(
    method: &str,
    url: &str,
    headers: &[(String, String)],
    body: Option<Vec<u8>>,
    body_within: Option<Duration>,
    follow: bool,
) -> Result<(Answer, ureq::http::Response<ureq::Body>), String> {
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .http_status_as_error(false)
        .max_redirects(if follow { 10 } else { 0 })
        .timeout_connect(Some(CONNECT))
        .timeout_recv_response(Some(WAIT))
        .timeout_recv_body(body_within)
        .build()
        .into();
    let mut builder = ureq::http::Request::builder().method(method).uri(url);
    for (name, value) in headers {
        builder = builder.header(name, value);
    }
    let request = builder.body(body.unwrap_or_default()).map_err(|e| e.to_string())?;
    let response = agent.run(request).map_err(|e| e.to_string())?;
    let status = response.status();
    let final_url = ureq::ResponseExt::get_uri(&response).to_string();
    let headers = response.headers().iter().map(|(n, v)| (n.as_str().to_owned(), String::from_utf8_lossy(v.as_bytes()).into_owned())).collect();
    let answer = Answer {
        status: status.as_u16(),
        status_text: status.canonical_reason().unwrap_or_default().to_owned(),
        redirected: final_url != url,
        url: final_url,
        headers,
        body: Vec::new(),
    };
    Ok((answer, response))
}

/// Hands what the requests' threads got on to their scripts, on the script's turn. The requests
/// stay where `cancel()` finds them while `receive()` runs.
pub(crate) fn poll<H: Clone>(call: &mut dyn Call<H>) -> Result<(), Error> {
    let arrived: Vec<(u32, H, Vec<Event>)> = call
        .host()?
        .borrow()
        .fetches
        .iter()
        .map(|fetch| {
            let mut events: Vec<Event> = std::iter::from_fn(|| fetch.events.try_recv().ok()).collect();
            // A thread that ended without a word failed:
            if !events.iter().any(|e| matches!(e, Event::End | Event::Failed(_)))
                && matches!(fetch.events.try_recv(), Err(TryRecvError::Disconnected))
            {
                events.push(Event::Failed("the request's thread ended".into()));
            }
            (fetch.number, fetch.receive.clone(), events)
        })
        .filter(|(_, _, events)| !events.is_empty())
        .collect();
    for (number, receive, events) in arrived {
        for event in events {
            if !call.host()?.borrow().fetches.iter().any(|f| f.number == number) {
                break;
            }
            let (value, is_done) = match event {
                Event::Head(answer) => (head(call, answer)?, false),
                Event::Part(bytes) => (Value::Js(call.new_uint8_array(&bytes)?), false),
                Event::End => (Value::Null, true),
                Event::Failed(message) => (Value::String(message), true),
            };
            if is_done {
                call.host()?.borrow_mut().fetches.retain(|f| f.number != number);
            }
            call.call(&receive, &Value::Undefined, &[value])?;
        }
    }
    Ok(())
}

/// The head of a response, as `fetch()` makes its `Response` of it.
fn head<H: Clone>(call: &mut dyn Call<H>, answer: Answer) -> Result<Value<H>, Error> {
    let response = call.new_object()?;
    let headers = answer
        .headers
        .into_iter()
        .map(|(n, v)| call.new_array(&[Value::String(n), Value::String(v)]).map(Value::Js))
        .collect::<Result<Vec<_>, _>>()?;
    let fields = [
        ("status", Value::Number(f64::from(answer.status))),
        ("statusText", Value::String(answer.status_text)),
        ("url", Value::String(answer.url)),
        ("redirected", Value::Bool(answer.redirected)),
        ("headers", Value::Js(call.new_array(&headers)?)),
    ];
    for (key, value) in fields {
        call.set(&response, key, &value)?;
    }
    Ok(Value::Js(response))
}
