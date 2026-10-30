//! `unhandledrejection` and `rejectionhandled` outside a browser: the engines track the Promises a
//! call rejects without a handler, and the handlers added to them later, and once the call's
//! microtasks ran, the bundle fires the events (core's `src/rejections.js`), as browsers do.

use std::cell::RefCell;

use crate::{Call, Error, Host, Value, method};

/// What an engine tracks of a rejected Promise.
pub(crate) enum Rejection<H> {
    /// It was rejected, with this reason, and nothing handles it.
    Unhandled(H, Value<H>),
    /// A handler was added to it after it was rejected.
    Handled(H),
}

/// Keeps `rejection` for [`notify`]. A rejection while the host state is in use can't be
/// kept: host functions run no script while they use it, so none happens then.
pub(crate) fn track<H>(host: &RefCell<Host<H>>, rejection: Rejection<H>) {
    if let Ok(mut host) = host.try_borrow_mut() {
        host.rejections.push(rejection);
    }
}

/// Hands the rejections tracked since the last time to the bundle, which fires the events.
/// Before it runs, and on the web, where the browser fires them, there's nothing to hand them to.
pub(crate) fn notify<H: Clone>(call: &mut dyn Call<H>) -> Result<(), Error> {
    // The snapshot's prelude runs without host state.
    let Ok(host) = call.host() else {
        return Ok(());
    };
    let (rejections, shared) = {
        let mut host = host.borrow_mut();
        (std::mem::take(&mut host.rejections), host.shared.clone())
    };
    let Some(shared) = shared.filter(|_| !rejections.is_empty()) else {
        return Ok(());
    };
    if !matches!(call.get(&shared, "notifyRejections")?, Value::Js(_)) {
        return Ok(());
    }
    let events = rejections
        .into_iter()
        .map(|rejection| {
            let event = match rejection {
                Rejection::Unhandled(promise, reason) => [Value::Js(promise), Value::Bool(false), reason],
                Rejection::Handled(promise) => [Value::Js(promise), Value::Bool(true), Value::Undefined],
            };
            call.new_array(&event).map(Value::Js)
        })
        .collect::<Result<Vec<_>, _>>()?;
    let events = call.new_array(&events)?;
    method(call, &shared, "notifyRejections", &[Value::Js(events)]).map(|_| ())
}
