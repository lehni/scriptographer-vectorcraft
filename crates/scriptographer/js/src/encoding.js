import { getBufferBytes } from './blob.js'
import { inject, setToStringTag } from './define.js'
import { natives } from './natives.js'
import { TransformStream } from './streams.js'

// `TextEncoder` and `TextDecoder` for scripts outside a browser: UTF-8, as the
// Encoding standard has it, which the runtime encodes and decodes.

export class TextEncoder {
  encode(text = '') {
    return natives.encoding.encode(String(text))
  }

  // As much of `text` as fits in `bytes`, whole characters only.
  encodeInto(text, bytes) {
    text = String(text)
    let read = 0
    let written = 0
    for (const char of text) {
      const point = char.codePointAt(0)
      const length =
        point < 0x80 ? 1 : point < 0x800 ? 2 : point < 0x10000 ? 3 : 4
      if (written + length > bytes.length) break
      read += char.length
      written += length
    }
    bytes.set(natives.encoding.encode(text.slice(0, read)))
    return { read, written }
  }
}

const labels = ['utf-8', 'utf8', 'unicode-1-1-utf-8', 'unicode11utf8']

export class TextDecoder {
  #fatal
  #ignoreBOM
  // The bytes of a character a streamed chunk ended in the middle of, and
  // whether the stream is yet to start:
  #pending = new Uint8Array()
  #isStart = true

  constructor(label = 'utf-8', { fatal = false, ignoreBOM = false } = {}) {
    label = String(label).trim().toLowerCase()
    if (!labels.includes(label)) {
      throw new RangeError(`Unsupported encoding: '${label}', only UTF-8.`)
    }
    this.#fatal = !!fatal
    this.#ignoreBOM = !!ignoreBOM
  }

  get fatal() {
    return this.#fatal
  }

  get ignoreBOM() {
    return this.#ignoreBOM
  }

  // A buffer's or a view's bytes as text: invalid sequences replaced, or a
  // `TypeError` when the decoder is `fatal`.
  decode(input = new Uint8Array(), { stream = false } = {}) {
    const given = getBufferBytes(input) ?? new Uint8Array(input)
    let bytes = given
    if (this.#pending.length) {
      bytes = new Uint8Array(this.#pending.length + given.length)
      bytes.set(this.#pending)
      bytes.set(given, this.#pending.length)
    }
    const end = stream ? bytes.length - getIncomplete(bytes) : bytes.length
    this.#pending = bytes.slice(end)
    let text = natives.encoding.decode(bytes.subarray(0, end), this.#fatal)
    if (text === null) {
      throw new TypeError('Invalid UTF-8: the data is not valid UTF-8.')
    }
    if (this.#isStart && !this.#ignoreBOM && text.startsWith('﻿')) {
      text = text.slice(1)
    }
    this.#isStart = !stream || this.#isStart && !text
    return text
  }
}

for (const target of [TextEncoder.prototype, TextDecoder.prototype]) {
  inject(
    target,
    {
      get encoding() {
        return 'utf-8'
      }
    },
    { enumerable: true }
  )
}
// The same, chunk by chunk, as streams that strings and bytes go through:
export class TextEncoderStream {
  #transform

  constructor() {
    const encoder = new TextEncoder()
    // A chunk can end in the first half of a surrogate pair:
    let pending = ''
    this.#transform = new TransformStream({
      transform(chunk, controller) {
        let text = pending + String(chunk)
        pending = /[\ud800-\udbff]$/.test(text) ? text.slice(-1) : ''
        if (pending) text = text.slice(0, -1)
        if (text) controller.enqueue(encoder.encode(text))
      },

      flush(controller) {
        if (pending) controller.enqueue(encoder.encode(pending))
      }
    })
  }

  get readable() {
    return this.#transform.readable
  }

  get writable() {
    return this.#transform.writable
  }
}

export class TextDecoderStream {
  #decoder
  #transform

  constructor(label, options) {
    const decoder = (this.#decoder = new TextDecoder(label, options))
    this.#transform = new TransformStream({
      transform(chunk, controller) {
        if (!getBufferBytes(chunk)) {
          throw new TypeError(`Invalid chunk: '${chunk}', not a buffer.`)
        }
        const text = decoder.decode(chunk, { stream: true })
        if (text) controller.enqueue(text)
      },

      flush(controller) {
        const text = decoder.decode()
        if (text) controller.enqueue(text)
      }
    })
  }

  get fatal() {
    return this.#decoder.fatal
  }

  get ignoreBOM() {
    return this.#decoder.ignoreBOM
  }

  get readable() {
    return this.#transform.readable
  }

  get writable() {
    return this.#transform.writable
  }
}

for (const target of [
  TextEncoderStream.prototype,
  TextDecoderStream.prototype
]) {
  inject(
    target,
    {
      get encoding() {
        return 'utf-8'
      }
    },
    { enumerable: true }
  )
}
setToStringTag(TextEncoder, TextDecoder, TextEncoderStream, TextDecoderStream)

// How many of the bytes at the end start a character that isn't complete.
function getIncomplete(bytes) {
  for (let back = 1; back <= Math.min(3, bytes.length); back++) {
    const byte = bytes[bytes.length - back]
    if (byte >= 0xc0) {
      const length = byte >= 0xf0 ? 4 : byte >= 0xe0 ? 3 : 2
      return length > back ? back : 0
    } else if (byte < 0x80) {
      return 0
    }
  }
  return 0
}
