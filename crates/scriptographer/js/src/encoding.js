import { getBufferBytes } from './blob.js'
import { defineInterfaces, toUSVString } from './define.js'
import { natives } from './natives.js'
import { TransformStream } from './streams.js'

// `TextEncoder` and `TextDecoder` for scripts outside a browser: UTF-8, as the
// Encoding standard has it, which the runtime encodes and decodes, and UTF-16
// for the decoder, whose text files some apps still write.

export class TextEncoder {
  get encoding() {
    return 'utf-8'
  }

  encode(text = '') {
    return natives.encoding.encode(String(text))
  }

  // As much of `text` as fits in `bytes`, whole characters only.
  encodeInto(text, bytes) {
    if (!(bytes instanceof Uint8Array)) {
      throw new TypeError('Invalid encodeInto(): the bytes are no Uint8Array.')
    }
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
    // `set()` throws on a detached buffer, even with nothing to set:
    if (read) bytes.set(natives.encoding.encode(text.slice(0, read)))
    return { read, written }
  }
}

// The encodings the decoder reads, with their labels:
const encodings = {
  'utf-8': [
    'unicode-1-1-utf-8',
    'unicode11utf8',
    'unicode20utf8',
    'utf-8',
    'utf8',
    'x-unicode20utf8'
  ],
  'utf-16be': ['unicodefffe', 'utf-16be'],
  'utf-16le': [
    'csunicode',
    'iso-10646-ucs-2',
    'ucs-2',
    'unicode',
    'unicodefeff',
    'utf-16',
    'utf-16le'
  ]
}

export class TextDecoder {
  #encoding
  #fatal
  #ignoreBOM
  // The bytes of a character a streamed chunk ended in the middle of, and
  // whether the stream is yet to start:
  #pending = new Uint8Array()
  #isStart = true

  constructor(label = 'utf-8', { fatal = false, ignoreBOM = false } = {}) {
    // Labels are ASCII, without the ASCII whitespace around them:
    label = String(label)
      .replace(/^[\t\n\f\r ]+|[\t\n\f\r ]+$/g, '')
      .replace(/[A-Z]/g, char => char.toLowerCase())
    this.#encoding = Object.keys(encodings).find(name =>
      encodings[name].includes(label)
    )
    if (!this.#encoding) {
      throw new RangeError(
        `Unsupported encoding: '${label}', only UTF-8 and UTF-16.`
      )
    }
    this.#fatal = !!fatal
    this.#ignoreBOM = !!ignoreBOM
  }

  get encoding() {
    return this.#encoding
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
    const isUTF8 = this.#encoding === 'utf-8'
    const isBigEndian = this.#encoding === 'utf-16be'
    const end = !stream
      ? bytes.length
      : bytes.length -
        (isUTF8 ? getIncomplete(bytes) : getIncompleteUTF16(bytes, isBigEndian))
    this.#pending = bytes.slice(end)
    const part = bytes.subarray(0, end)
    let text = isUTF8
      ? natives.encoding.decode(part, this.#fatal)
      : decodeUTF16(part, isBigEndian, this.#fatal)
    if (text === null) {
      // The stream starts over after an error, as a new decoder:
      this.#pending = new Uint8Array()
      this.#isStart = true
      throw new TypeError(
        `Invalid ${this.#encoding}: the data is not valid ${this.#encoding}.`
      )
    }
    // Only the first character can be a BOM, even when it's the only one:
    const isStart = this.#isStart
    this.#isStart = !stream || isStart && !text
    if (isStart && !this.#ignoreBOM && text.startsWith('\ufeff')) {
      text = text.slice(1)
    }
    return text
  }
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

  get encoding() {
    return 'utf-8'
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

  get encoding() {
    return this.#decoder.encoding
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

defineInterfaces(TextEncoder, TextDecoder, TextEncoderStream, TextDecoderStream)

// How many of the bytes at the end start a UTF-8 character that's valid so far
// but not complete, which a streamed chunk keeps for the next one.
function getIncomplete(bytes) {
  for (let back = 1; back <= Math.min(3, bytes.length); back++) {
    const lead = bytes[bytes.length - back]
    if (lead < 0x80 || lead >= 0xc0) {
      const length =
        lead < 0xc2 || lead > 0xf4 ? 1 : lead >= 0xf0 ? 4 : lead >= 0xe0 ? 3 : 2
      if (length <= back) return 0
      // After some leads, the second byte has narrower bounds, as the
      // Encoding standard's decoder checks them:
      const second = bytes[bytes.length - back + 1]
      const [lower, upper] =
        lead === 0xe0
          ? [0xa0, 0xbf]
          : lead === 0xed
            ? [0x80, 0x9f]
            : lead === 0xf0
              ? [0x90, 0xbf]
              : lead === 0xf4
                ? [0x80, 0x8f]
                : [0x80, 0xbf]
      return back === 1 || second >= lower && second <= upper ? back : 0
    }
  }
  return 0
}

// The same for UTF-16: an odd byte, after a lead surrogate perhaps.
function getIncompleteUTF16(bytes, isBigEndian) {
  const odd = bytes.length % 2
  const end = bytes.length - odd
  const unit = end >= 2 ? getUnit(bytes, end - 2, isBigEndian) : 0
  return odd + (isLead(unit) ? 2 : 0)
}

// UTF-16 `bytes` as text: unpaired surrogates and an odd byte replaced, or
// `null` when `isFatal`.
function decodeUTF16(bytes, isBigEndian, isFatal) {
  const isOdd = bytes.length % 2 === 1
  let count = bytes.length >> 1
  // A lead surrogate before an odd byte is one character cut short:
  if (isOdd && count && isLead(getUnit(bytes, 2 * count - 2, isBigEndian))) {
    count--
  }
  const units = new Uint16Array(count)
  for (let i = 0; i < units.length; i++) {
    units[i] = getUnit(bytes, 2 * i, isBigEndian)
  }
  let text = ''
  for (let i = 0; i < units.length; i += 0x2000) {
    text += String.fromCharCode(...units.subarray(i, i + 0x2000))
  }
  const decoded = toUSVString(text) + (isOdd ? '\ufffd' : '')
  return isFatal && decoded !== text ? null : decoded
}

function getUnit(bytes, index, isBigEndian) {
  const [high, low] = isBigEndian
    ? [bytes[index], bytes[index + 1]]
    : [bytes[index + 1], bytes[index]]
  return (high << 8) | low
}

function isLead(unit) {
  return unit >= 0xd800 && unit <= 0xdbff
}
