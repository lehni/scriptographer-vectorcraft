import { inject, setToStringTag } from './define.js'
import {
  ErrorEvent,
  EventTarget,
  MessageEvent,
  defineEventHandlers
} from './events.js'
import { MessageChannel, postWith, takePort } from './message-port.js'
import { natives } from './natives.js'

// `Worker` for scripts outside a browser, and what a worker's global object
// has. The runtime runs each worker's script on a thread of its own, in a
// runtime of its own, and passes the messages both ways as structured
// serialization keeps them, with the `MessagePort`s they transfer. Module
// workers aren't supported.

export class Worker extends EventTarget {
  #number

  constructor(url, { type = 'classic', name = '' } = {}) {
    super()
    if (type === 'module') {
      throw new DOMException(
        'Unsupported Worker: module workers are not supported.',
        'NotSupportedError'
      )
    }
    this.#number = natives.worker.start(String(url), String(name), sent =>
      this.#receive(sent)
    )
  }

  postMessage(data, transfer) {
    postWith(transfer, (ports, numbers, buffers) =>
      natives.worker.post(this.#number, data, ports, numbers, buffers)
    )
  }

  terminate() {
    natives.worker.terminate(this.#number)
  }

  // What the worker sent: `{ type, data, ports }` or `{ type: 'error', message }`.
  #receive({ type, data, ports, message }) {
    if (type === 'error') {
      // Unless a handler prevents it, the error shows in the console too, as in
      // browsers.
      const event = new ErrorEvent('error', { message, cancelable: true })
      if (this.dispatchEvent(event)) {
        console.error(`Uncaught (in worker) ${message}`)
      }
    } else {
      this.dispatchEvent(new MessageEvent(type, { data, ports }))
    }
  }
}

defineEventHandlers(Worker.prototype, 'message', 'messageerror', 'error')

// The worker of the script at `url` and its name that all of the app's scripts
// share, as of one origin: each one talks to it through its own `port`.
export class SharedWorker extends EventTarget {
  #port

  constructor(url, options) {
    super()
    const { type = 'classic', name = '' } =
      typeof options === 'string' ? { name: options } : (options ?? {})
    if (type === 'module') {
      throw new DOMException(
        'Unsupported SharedWorker: module workers are not supported.',
        'NotSupportedError'
      )
    }
    const { port1, port2 } = new MessageChannel()
    this.#port = port1
    natives.worker.connect(
      String(url),
      String(name),
      takePort(port2),
      ({ message }) => {
        // Unless a handler prevents it, the error shows in the console too.
        const event = new ErrorEvent('error', { message, cancelable: true })
        if (this.dispatchEvent(event)) {
          console.error(`Uncaught (in shared worker) ${message}`)
        }
      }
    )
  }

  get port() {
    return this.#port
  }
}

defineEventHandlers(SharedWorker.prototype, 'error')
setToStringTag(Worker, SharedWorker)

// Give the worker's global object, an `EventTarget` as every one is here, what
// a worker's has: `name`, `close()` and `importScripts()`, and a dedicated
// one's `postMessage()`. What the parent sends, or the port of a script that
// connects to a shared one, the runtime hands to the function this returns.
export function setupWorker(name, isShared) {
  const { close, importScripts } = natives.worker.self
  inject(globalThis, { name, close, importScripts })
  if (isShared) {
    defineEventHandlers(globalThis, 'connect')
    return port =>
      globalThis.dispatchEvent(
        new MessageEvent('connect', { data: '', ports: [port] })
      )
  } else {
    inject(globalThis, {
      postMessage(data, transfer) {
        postWith(transfer, (ports, numbers, buffers) =>
          natives.worker.self.postMessage(data, ports, numbers, buffers)
        )
      }
    })
    defineEventHandlers(globalThis, 'message', 'messageerror')
    return ({ type, data, ports }) =>
      globalThis.dispatchEvent(new MessageEvent(type, { data, ports }))
  }
}
