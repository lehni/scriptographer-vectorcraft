import { internal, checkInternal, setToStringTag } from './define.js'
import { natives } from './natives.js'

// `navigator.locks` for scripts outside a browser: the Web Locks of all of the
// app's scripts and their workers, as of one origin, which the runtime keeps.

export class Lock {
  #name
  #mode

  constructor(key, name, mode) {
    checkInternal(key, 'Lock', 'navigator.locks.request() gives them')
    this.#name = name
    this.#mode = mode
  }

  get name() {
    return this.#name
  }

  get mode() {
    return this.#mode
  }
}

export class LockManager {
  constructor(key) {
    checkInternal(key, 'LockManager', 'navigator.locks is one')
  }

  // `request(name, [options,] callback)`: a Promise of what the callback gives
  // once it ran with the lock, which is released then.
  async request(name, ...args) {
    const callback = args.pop()
    const options = args[0] ?? {}
    if (typeof callback !== 'function') {
      throw new TypeError(`Invalid callback: '${callback}', not a function.`)
    }
    const {
      mode = 'exclusive',
      ifAvailable = false,
      steal = false,
      signal
    } = options
    name = String(name)
    const unsupported = message =>
      new DOMException(message, 'NotSupportedError')
    if (mode !== 'exclusive' && mode !== 'shared') {
      throw new TypeError(`Invalid lock mode: '${mode}'.`)
    } else if (name.startsWith('-')) {
      throw unsupported(`Invalid lock name: '${name}', starting with '-'.`)
    } else if (steal && (ifAvailable || mode === 'shared')) {
      throw unsupported('Unable to steal a lock if available or shared.')
    } else if (signal && (steal || ifAvailable)) {
      throw unsupported('Unable to abort a request that steals or waits not.')
    }
    signal?.throwIfAborted()
    return new Promise((resolve, reject) => {
      let id
      const abort = () => {
        natives.locks.cancel(id)
        reject(signal.reason)
      }
      // The callback runs with the lock, or `null` when it's not available,
      // unless the signal aborted the request since:
      const run = async isGranted => {
        signal?.removeEventListener('abort', abort)
        if (signal?.aborted) {
          natives.locks.release(id)
          reject(signal.reason)
          return
        }
        try {
          resolve(
            await callback(isGranted ? new Lock(internal, name, mode) : null)
          )
        } catch (err) {
          reject(err)
        } finally {
          if (isGranted) natives.locks.release(id)
        }
      }
      const receive = state => {
        if (state === 'granted') {
          run(true)
        } else {
          reject(new DOMException('The lock was stolen.', 'AbortError'))
        }
      }
      const [number, state] = natives.locks.request(
        toKey(name),
        mode === 'exclusive',
        ifAvailable,
        steal,
        receive
      )
      id = number
      if (state === 'waiting') {
        signal?.addEventListener('abort', abort)
      } else {
        queueMicrotask(() => run(state === 'granted'))
      }
    })
  }

  async query() {
    const { held, pending } = natives.locks.query()
    const decode = list =>
      list.map(info => ({ ...info, name: fromKey(info.name) }))
    return { held: decode(held), pending: decode(pending) }
  }
}

setToStringTag(Lock, LockManager)

// A name as the runtime keeps it, its UTF-16 code units in hex, so it stays as
// it is, unpaired surrogates too, and back:
function toKey(name) {
  return Array.from({ length: name.length }, (_, i) =>
    name.charCodeAt(i).toString(16).padStart(4, '0')
  ).join('')
}

function fromKey(key) {
  return String.fromCharCode(
    ...(key.match(/.{4}/g) ?? []).map(code => parseInt(code, 16))
  )
}
