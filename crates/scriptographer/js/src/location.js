import { checkInternal, defineInterfaces, inject, internal } from './define.js'

// `location` for scripts outside a browser: the URL of the script's file, which
// relative URLs resolve against, read only, as a worker's `WorkerLocation` is.

export class WorkerLocation {
  #url

  constructor(key, href) {
    checkInternal(key, 'WorkerLocation', 'a script has the one of its file')
    this.#url = new URL(href)
  }

  get href() {
    return this.#url.href
  }

  get origin() {
    return this.#url.origin
  }

  get protocol() {
    return this.#url.protocol
  }

  get host() {
    return this.#url.host
  }

  get hostname() {
    return this.#url.hostname
  }

  get port() {
    return this.#url.port
  }

  get pathname() {
    return this.#url.pathname
  }

  get search() {
    return this.#url.search
  }

  get hash() {
    return this.#url.hash
  }

  toString() {
    return this.#url.href
  }
}

defineInterfaces(WorkerLocation)

// Gives the global object the `location` of `href`.
export function setLocation(href) {
  const location = new WorkerLocation(internal, href)
  inject(
    globalThis,
    {
      get location() {
        return location
      }
    },
    { configurable: true }
  )
}
