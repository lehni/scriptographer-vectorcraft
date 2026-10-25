import { natives } from './natives.js'
import { inject } from './define.js'
import { KeyboardEvent, fire } from './events.js'

// `window` and `document` for scripts outside a browser: linkedom's, which the
// runtime loads the first time a script reads either one.

let view

export const dom = {
  get window() {
    return (view ??= loadView())
  },

  get document() {
    return (view ??= loadView()).document
  }
}

const keyTypes = ['keydown', 'keyup']
// The targets that get the keys typed on the canvas, with their key listeners,
// which keep a script running, as a page lives while it's open:
const keyTargets = []

// Track the key listeners of the global object, and in a browser's window, of
// its document; outside a browser, the document is tracked once it's loaded.
export function setupKeys() {
  trackKeys(globalThis)
  if (!natives.dom && globalThis.document) trackKeys(document)
}

export function hasKeyListeners() {
  return keyTargets.some(({ target, listeners }) =>
    keyTypes.some(type => listeners.get(type).length > 0 || target[`on${type}`])
  )
}

// Fire the key `type` (`keydown`, `keyup`) with the `KeyboardEvent` members of
// `init` at the document, from where it bubbles up to the window, as in a
// browser. Whether a listener prevented its default.
export function dispatchKey(type, init) {
  const options = { ...init, bubbles: true, cancelable: true }
  const reached = []
  let prevented
  if (!natives.dom) {
    const event = new globalThis.KeyboardEvent(type, options)
    prevented = !document.dispatchEvent(event)
    reached.push(document, globalThis)
  } else {
    // linkedom's document takes its own events only, which bubble up to its
    // window but not on to the global object, so it gets one of its own, with
    // the members of ours, unless no script read the document yet:
    const event = new KeyboardEvent(type, options)
    let stopped = false
    if (view) {
      const { document } = view
      const documentEvent = new view.Event(type, options)
      for (const name in event) {
        if (!(name in documentEvent)) documentEvent[name] = event[name]
      }
      documentEvent.getModifierState = key => event.getModifierState(key)
      document[`on${type}`]?.call(document, documentEvent)
      document.dispatchEvent(documentEvent)
      reached.push(document)
      if (documentEvent.defaultPrevented) event.preventDefault()
      stopped = documentEvent.cancelBubble
    }
    if (!stopped) {
      fire(globalThis, event)
      reached.push(globalThis)
    }
    prevented = event.defaultPrevented
  }
  // The `once` listeners the key reached are gone:
  for (const { target, listeners } of keyTargets) {
    if (reached.includes(target)) {
      listeners.set(
        type,
        listeners.get(type).filter(entry => !entry.once)
      )
    }
  }
  return prevented
}

function loadView() {
  const view = natives.dom()
  // The window's events are the global object's, as in a browser. linkedom
  // makes its own target for them the first time they're read:
  void view.addEventListener
  const { addEventListener, removeEventListener, dispatchEvent } = globalThis
  Object.assign(view, { addEventListener, removeEventListener, dispatchEvent })
  trackKeys(view.document)
  return view
}

function trackKeys(target) {
  // Each listener with its capture, which tells it apart as the DOM does:
  const listeners = new Map(keyTypes.map(type => [type, []]))
  keyTargets.push({ target, listeners })
  const { addEventListener, removeEventListener } = target
  const find = (entries, listener, capture) =>
    entries.findIndex(
      entry => entry.listener === listener && entry.capture === capture
    )
  inject(target, {
    addEventListener(type, listener, options) {
      const entries = listeners.get(type)
      const { capture, once, signal } = getOptions(options)
      if (
        entries &&
        listener &&
        !signal?.aborted &&
        find(entries, listener, capture) < 0
      ) {
        const entry = { listener, capture, once }
        entries.push(entry)
        signal?.addEventListener('abort', () => {
          const entries = listeners.get(type)
          const index = entries.indexOf(entry)
          if (index >= 0) entries.splice(index, 1)
        })
      }
      return addEventListener.call(this, type, listener, options)
    },

    removeEventListener(type, listener, options) {
      const entries = listeners.get(type)
      const index = entries
        ? find(entries, listener, getOptions(options).capture)
        : -1
      if (index >= 0) entries.splice(index, 1)
      return removeEventListener.call(this, type, listener, options)
    }
  })
}

// The listener options as the DOM reads them: `capture` from a boolean too.
function getOptions(options) {
  return options && typeof options === 'object'
    ? {
        capture: !!options.capture,
        once: !!options.once,
        signal: options.signal
      }
    : { capture: !!options, once: false, signal: null }
}
