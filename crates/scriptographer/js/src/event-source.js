import { checkArguments, defineConstants, defineInterfaces } from './define.js'
import {
  Event,
  EventTarget,
  MessageEvent,
  defineEventHandlers
} from './events.js'
import { natives } from './natives.js'

// `EventSource` for scripts outside a browser: the runtime reads the stream on
// a thread, connects again after it ends, and hands the script its events on
// its turn. Credentials aren't sent: there are no cookies.

const states = { CONNECTING: 0, OPEN: 1, CLOSED: 2 }

export class EventSource extends EventTarget {
  #url
  #withCredentials
  #origin = ''
  #readyState = states.CONNECTING
  // `null` once the connection is closed:
  #number

  constructor(url, { withCredentials = false } = {}) {
    checkArguments(arguments, 1, 'EventSource')
    super()
    try {
      this.#url = new URL(url).href
    } catch {
      throw new DOMException(`Invalid URL: '${url}'.`, 'SyntaxError')
    }
    this.#withCredentials = !!withCredentials
    this.#number = natives.eventSource.open(this.#url, received =>
      this.#receive(received)
    )
  }

  get url() {
    return this.#url
  }

  get withCredentials() {
    return this.#withCredentials
  }

  get readyState() {
    return this.#readyState
  }

  close() {
    if (this.#number !== null) {
      natives.eventSource.close(this.#number)
      this.#number = null
    }
    this.#readyState = states.CLOSED
  }

  // What the runtime read: `{ state, … }`, `state` one of 'open', 'event',
  // 'reconnecting' and 'failed'.
  #receive({ state, url, type, data, lastEventId }) {
    if (state === 'open') {
      this.#readyState = states.OPEN
      this.#origin = new URL(url).origin
      this.dispatchEvent(new Event('open'))
    } else if (state === 'event') {
      const origin = this.#origin
      this.dispatchEvent(new MessageEvent(type, { data, lastEventId, origin }))
    } else {
      this.#readyState =
        state === 'reconnecting' ? states.CONNECTING : states.CLOSED
      if (state === 'failed') this.#number = null
      this.dispatchEvent(new Event('error'))
    }
  }
}

defineConstants(EventSource, states)
defineEventHandlers(EventSource.prototype, 'open', 'message', 'error')
defineInterfaces(EventSource)
