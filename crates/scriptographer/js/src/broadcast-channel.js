import { checkArguments, setToStringTag } from './define.js'
import {
  EventTarget,
  MessageEvent,
  defineEventHandlers
} from './events.js'
import { natives } from './natives.js'

// `BroadcastChannel` for scripts outside a browser: all of the app's scripts
// and their workers are of one origin, and the runtime hands each channel what
// the others of its name posted, on the script's turn. An open channel keeps
// its script running, until it's closed.

export class BroadcastChannel extends EventTarget {
  #name
  // `null` once the channel is closed:
  #number

  constructor(name) {
    checkArguments(arguments, 1, 'BroadcastChannel')
    super()
    this.#name = String(name)
    this.#number = natives.broadcast.open(this.#name, ({ type, data }) =>
      this.dispatchEvent(new MessageEvent(type, { data }))
    )
  }

  get name() {
    return this.#name
  }

  postMessage(message) {
    checkArguments(arguments, 1, 'postMessage')
    if (this.#number === null) {
      throw new DOMException(
        'Unable to post to a BroadcastChannel that is closed.',
        'InvalidStateError'
      )
    }
    natives.broadcast.post(this.#number, message)
  }

  close() {
    if (this.#number !== null) {
      natives.broadcast.close(this.#number)
      this.#number = null
    }
  }
}

defineEventHandlers(BroadcastChannel.prototype, 'message', 'messageerror')
setToStringTag(BroadcastChannel)
