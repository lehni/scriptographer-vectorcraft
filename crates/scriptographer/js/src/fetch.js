import { Blob, File, getBufferBytes, getBytes, joinBytes } from './blob.js'
import { checkArguments, inject, setToStringTag } from './define.js'
import { natives } from './natives.js'
import { getPairs, pairIterable, setFirst } from './pairs.js'
import { ReadableStream } from './streams.js'

// The browser's `fetch()` for scripts outside a browser, with `Headers`,
// `FormData`, `Request` and `Response`. The runtime sends the requests, on
// threads of its own. A response's body streams as it arrives; a stream that
// a request sends is read before it goes. There is no CORS, cookie store or
// HTTP cache outside a browser.

export class Headers {
  // The headers as they came, names in lower case:
  #list = []

  constructor(init) {
    if (init instanceof Headers) {
      this.#list = [...init.#list]
    } else if (init != null) {
      for (const [name, value] of getPairs(init)) this.append(name, value)
    }
  }

  get(name) {
    const values = this.#getValues(name)
    return values.length ? values.join(', ') : null
  }

  getSetCookie() {
    return this.#getValues('set-cookie')
  }

  has(name) {
    return this.#getValues(name).length > 0
  }

  set(name, value) {
    this.#list = setFirst(this.#list, getHeader(name, value))
  }

  append(name, value) {
    this.#list.push(getHeader(name, value))
  }

  delete(name) {
    name = getName(name)
    this.#list = this.#list.filter(header => header[0] !== name)
  }

  // As scripts see them: sorted by name, the values of a name joined.
  *entries() {
    const names = [...new Set(this.#list.map(([name]) => name))].sort()
    for (const name of names) yield [name, this.get(name)]
  }

  #getValues(name) {
    name = getName(name)
    return this.#list
      .filter(header => header[0] === name)
      .map(([, value]) => value)
  }
}

export class FormData {
  // `[name, value]`, a value a string or a `File`:
  #entries = []

  append(name, value, filename) {
    checkArguments(arguments, 2, 'append')
    this.#entries.push(getEntry(...arguments))
  }

  set(name, value, filename) {
    checkArguments(arguments, 2, 'set')
    this.#entries = setFirst(this.#entries, getEntry(...arguments))
  }

  get(name) {
    return this.#entries.find(entry => entry[0] === String(name))?.[1] ?? null
  }

  getAll(name) {
    return this.#entries
      .filter(entry => entry[0] === String(name))
      .map(([, value]) => value)
  }

  has(name) {
    return this.#entries.some(entry => entry[0] === String(name))
  }

  delete(name) {
    this.#entries = this.#entries.filter(entry => entry[0] !== String(name))
  }

  *entries() {
    for (const [name, value] of this.#entries) yield [name, value]
  }
}

for (const Class of [Headers, FormData]) {
  inject(Class.prototype, pairIterable)
}

// What `Request` and `Response` share: their body, read once, as its bytes
// or as a stream.
class Body {
  #bytes = null
  #stream = null
  #isUsed = false

  // The body's bytes, or the stream it is, its type in `headers` unless they
  // have one.
  constructor(body, headers) {
    if (body instanceof ReadableStream) {
      this.#stream = body
    } else if (body != null) {
      const { bytes, type } = getBody(body)
      if (type && !headers.has('content-type')) {
        headers.set('content-type', type)
      }
      this.#bytes = bytes
    }
  }

  get body() {
    if (!this.#stream && this.#bytes) {
      const bytes = this.#bytes
      this.#stream = new ReadableStream({
        type: 'bytes',
        pull(controller) {
          if (bytes.length) controller.enqueue(bytes.slice())
          controller.close()
        }
      })
    }
    return this.#stream
  }

  // Read once its stream was read from, as web-streams-polyfill marks it:
  get bodyUsed() {
    return this.#isUsed || !!this.#stream?._disturbed
  }

  async text() {
    return new TextDecoder().decode(await this.#take())
  }

  async json() {
    return JSON.parse(await this.text())
  }

  async arrayBuffer() {
    return (await this.#take()).slice().buffer
  }

  async bytes() {
    return (await this.#take()).slice()
  }

  async blob() {
    const type = this.headers.get('content-type') ?? ''
    return new Blob([await this.#take()], { type })
  }

  async #take() {
    if (this.bodyUsed || this.#stream?.locked) {
      throw new TypeError('Unable to read the body: it was read already.')
    }
    this.#isUsed = true
    return this.#stream
      ? readStream(this.#stream)
      : (this.#bytes ?? new Uint8Array())
  }

  // The body, unread, for a copy: its bytes, or a branch of its stream, which
  // keeps the other.
  static copy(body) {
    if (body.bodyUsed || body.#stream?.locked) {
      throw new TypeError('Unable to copy the body: it was read already.')
    }
    if (body.#stream) {
      const [kept, copied] = body.#stream.tee()
      body.#stream = kept
      return copied
    }
    return body.#bytes
  }

  // The body's bytes, to send, or `null` without a body.
  static async read(body) {
    return body.#stream || body.#bytes ? body.#take() : null
  }
}

export class Request extends Body {
  #url
  #method
  #headers
  #signal
  #redirect

  constructor(input, init = {}) {
    const from = input instanceof Request ? input : null
    const method = String(init.method ?? from?.method ?? 'GET').toUpperCase()
    const headers = new Headers(init.headers ?? from?.headers)
    const body = init.body ?? (from && Body.copy(from))
    if (body != null && (method === 'GET' || method === 'HEAD')) {
      throw new TypeError(`Invalid Request: a ${method} request has no body.`)
    }
    super(body, headers)
    // The URL as parsed, against the script's location where there is one:
    this.#url = from ? from.url : new URL(input, globalThis.location?.href).href
    this.#method = method
    this.#headers = headers
    this.#signal = init.signal ?? from?.signal ?? null
    this.#redirect = String(init.redirect ?? from?.redirect ?? 'follow')
  }

  get url() {
    return this.#url
  }

  get method() {
    return this.#method
  }

  get headers() {
    return this.#headers
  }

  get signal() {
    return this.#signal
  }

  get redirect() {
    return this.#redirect
  }

  clone() {
    return new Request(this)
  }
}

let setResponse

export class Response extends Body {
  #status
  #statusText
  #headers
  #url = ''
  #redirected = false
  #type = 'default'

  constructor(body = null, { status = 200, statusText = '', headers } = {}) {
    status = Number(status)
    if (!(status >= 200 && status <= 599)) {
      throw new RangeError(`Invalid Response status: '${status}'.`)
    }
    headers = new Headers(headers)
    super(body, headers)
    this.#status = status
    this.#statusText = String(statusText)
    this.#headers = headers
  }

  static {
    // What a response that came over the network says of itself:
    setResponse = (response, { url, redirected, type }) => {
      response.#url = url
      response.#redirected = redirected
      response.#type = type
      return response
    }
  }

  get status() {
    return this.#status
  }

  get statusText() {
    return this.#statusText
  }

  get ok() {
    return this.#status >= 200 && this.#status <= 299
  }

  get headers() {
    return this.#headers
  }

  get url() {
    return this.#url
  }

  get redirected() {
    return this.#redirected
  }

  get type() {
    return this.#type
  }

  clone() {
    const { status, statusText, headers } = this
    return setResponse(
      new Response(Body.copy(this), { status, statusText, headers }),
      this
    )
  }
}

setToStringTag(Headers, FormData, Request, Response)

// A Promise of the `Response`, once its head is in, rejected with a
// `TypeError` when the request fails, or with the signal's reason when it
// aborts, which errors the body too while it arrives.
export async function fetch(input, init) {
  const request = new Request(input, init)
  const { method, url, headers, signal, redirect } = request
  // Read before it's sent, so the signal may have aborted meanwhile:
  const body = await Body.read(request)
  signal?.throwIfAborted()
  return new Promise((resolve, reject) => {
    let controller
    const stream = new ReadableStream({
      type: 'bytes',
      start(c) {
        controller = c
      },
      cancel() {
        finish()
      }
    })
    // What the runtime hands on: the response's head, then the parts of its
    // body, and `null` at its end; or why the request failed.
    const receive = value => {
      if (typeof value === 'string') {
        const err = new TypeError(`fetch failed: ${value}`)
        reject(err)
        controller.error(err)
        finish()
      } else if (value instanceof Uint8Array) {
        controller.enqueue(value)
      } else if (value) {
        const { status, statusText, url, redirected, headers } = value
        const response = new Response(stream, { status, statusText, headers })
        resolve(setResponse(response, { url, redirected, type: 'basic' }))
      } else {
        controller.close()
        finish()
      }
    }
    const number = natives.fetch.request(
      method,
      url,
      [...headers],
      body,
      redirect === 'follow',
      receive
    )
    const finish = () => {
      natives.fetch.cancel(number)
      signal?.removeEventListener('abort', abort)
    }
    // Once the response is complete, an abort changes nothing:
    const abort = () => {
      reject(signal.reason)
      controller.error(signal.reason)
      finish()
    }
    signal?.addEventListener('abort', abort)
  })
}

// The bytes of `stream`, which gives them as `Uint8Array`s, together:
async function readStream(stream) {
  const chunks = []
  for await (const chunk of stream) {
    if (!(chunk instanceof Uint8Array)) {
      throw new TypeError(`Invalid body chunk: '${chunk}', not a Uint8Array.`)
    }
    chunks.push(chunk)
  }
  return joinBytes(chunks)
}

// A body's bytes and the content type it implies, which the runtime reads too:
// a string, a buffer or a view, a `Blob`, `FormData` or `URLSearchParams`.
export function getBody(body) {
  const bytes = getBufferBytes(body)
  return bytes
    ? { bytes, type: null }
    : body instanceof Blob
      ? { bytes: getBytes(body), type: body.type || null }
      : body instanceof FormData
        ? getMultipart(body)
        : {
            bytes: new TextEncoder().encode(String(body)),
            type:
              body instanceof URLSearchParams
                ? 'application/x-www-form-urlencoded;charset=UTF-8'
                : 'text/plain;charset=UTF-8'
          }
}

// A header name as headers compare them, lower case, and its value, trimmed:
function getHeader(name, value) {
  return [getName(name), String(value).replace(/^[\t\n\r ]+|[\t\n\r ]+$/g, '')]
}

function getName(name) {
  return String(name).trim().toLowerCase()
}

// A `FormData` entry from `append(name, value[, filename])`: a `Blob` becomes
// a `File`, named `filename` or 'blob' if it has no name.
function getEntry(name, value, filename) {
  return [
    String(name),
    value instanceof Blob
      ? value instanceof File && filename === undefined
        ? value
        : new File([value], filename ?? value.name ?? 'blob', {
            type: value.type
          })
      : String(value)
  ]
}

// `FormData` as `multipart/form-data`, with a random boundary.
function getMultipart(form) {
  const boundary = `----Scriptographer${
    Array.from({ length: 24 }, () =>
      Math.floor(Math.random() * 16).toString(16)
    ).join('')
  }`
  const quote = text =>
    text.replace(/\r/g, '%0D').replace(/\n/g, '%0A').replace(/"/g, '%22')
  const parts = []
  for (const [name, value] of form) {
    const disposition = `--${
      boundary
    }\r\nContent-Disposition: form-data; name="${
      quote(name)
    }"`
    if (value instanceof File) {
      const type = value.type || 'application/octet-stream'
      parts.push(
        `${disposition}; filename="${quote(value.name)}"\r\nContent-Type: ${
          type
        }\r\n\r\n`,
        value,
        '\r\n'
      )
    } else {
      parts.push(`${disposition}\r\n\r\n${value}\r\n`)
    }
  }
  parts.push(`--${boundary}--\r\n`)
  return {
    bytes: getBytes(new Blob(parts)),
    type: `multipart/form-data; boundary=${boundary}`
  }
}
