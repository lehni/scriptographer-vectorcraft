import { PromiseRejectionEvent, fire } from './events.js'
import { formatError } from './format-error.js'

// `unhandledrejection` and `rejectionhandled` at the global object, as browsers
// fire them. Unless a listener prevents it, a rejection that nothing handles
// shows in the script's console.

// The reasons of the rejected Promises the script was told of, for
// `rejectionhandled` once a handler takes them:
const reasonsByPromise = new WeakMap()

// Outside a browser, the runtime tracks the rejections of its call, as
// `[promise, handled, reason]`, and hands them over once the microtasks ran.
export function notifyRejections(events) {
  const unhandled = new Map()
  for (const [promise, handled, reason] of events) {
    if (!handled) {
      unhandled.set(promise, reason)
    } else if (!unhandled.delete(promise) && reasonsByPromise.has(promise)) {
      const reason = reasonsByPromise.get(promise)
      reasonsByPromise.delete(promise)
      fire(
        globalThis,
        new PromiseRejectionEvent('rejectionhandled', { promise, reason })
      )
    }
  }
  for (const [promise, reason] of unhandled) {
    const event = new PromiseRejectionEvent('unhandledrejection', {
      promise,
      reason,
      cancelable: true
    })
    if (fire(globalThis, event)) report(reason)
    reasonsByPromise.set(promise, reason)
  }
}

// In a browser, which fires the events itself, we report the rejection once
// all listeners had the event, the script's too, which are added after ours.
export function reportRejections() {
  globalThis.addEventListener('unhandledrejection', event => {
    setTimeout(() => {
      if (!event.defaultPrevented) report(event.reason)
    })
  })
}

function report(reason) {
  console.error(`Uncaught (in promise) ${formatError(reason)}`)
}
