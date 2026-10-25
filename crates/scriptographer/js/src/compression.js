import { defineInterfaces } from './define.js'
import { natives } from './natives.js'
import { TransformStream } from './streams.js'

// `CompressionStream` and `DecompressionStream` for scripts outside a browser:
// the runtime's codecs, chunk by chunk, for gzip, deflate, deflate-raw and
// brotli.

function createTransform(format, decompress) {
  const number = natives.compression.open(String(format), decompress)
  return new TransformStream({
    transform(chunk, controller) {
      try {
        const buffer = ArrayBuffer.isView(chunk) ? chunk.buffer : chunk
        if (!(buffer instanceof ArrayBuffer)) {
          throw new TypeError(`Invalid chunk: '${chunk}', not a buffer.`)
        }
        // What it made before it failed, if it did, still goes out:
        const [bytes, failure] = natives.compression.write(number, chunk)
        if (bytes.length) controller.enqueue(bytes)
        if (failure) throw new TypeError(failure)
      } catch (err) {
        // The stream fails, and its codec goes:
        natives.compression.close(number)
        throw err
      }
    },

    flush(controller) {
      const bytes = natives.compression.finish(number)
      if (bytes.length) controller.enqueue(bytes)
    },

    cancel() {
      natives.compression.close(number)
    }
  })
}

export class CompressionStream {
  #transform

  constructor(format) {
    this.#transform = createTransform(format, false)
  }

  get readable() {
    return this.#transform.readable
  }

  get writable() {
    return this.#transform.writable
  }
}

export class DecompressionStream {
  #transform

  constructor(format) {
    this.#transform = createTransform(format, true)
  }

  get readable() {
    return this.#transform.readable
  }

  get writable() {
    return this.#transform.writable
  }
}

defineInterfaces(CompressionStream, DecompressionStream)
