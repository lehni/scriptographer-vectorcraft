import {
  checkArguments,
  checkInternal,
  inject,
  internal,
  defineInterfaces
} from './define.js'
import { EventTarget, Event, defineEventHandlers } from './events.js'
import { natives } from './natives.js'
import {
  TextCluster,
  TextMetrics,
  drawCluster,
  textSettings
} from './text-metrics.js'

// `OffscreenCanvas` and its kin for scripts outside a browser, with pixels: its
// `OffscreenCanvasRenderingContext2D` draws as the browser's does. The runtime
// keeps the pixels, paths, gradients, patterns and drawing state in slots, and
// draws (`natives.canvas`); each object here keeps the number of its slot, and
// frees it when the script drops the object.

const { canvas } = natives

// The slots of the objects, which the classes' static blocks reach:
let getCanvasSurface,
  getBitmapSurface,
  getImageBitmap,
  getPath,
  getGradientPaint,
  getPatternPaint

// What frees the slots of the objects the script dropped, when the realm can:
const registry = (
  globalThis.FinalizationRegistry &&
  new FinalizationRegistry(([kind, slot]) => canvas.release(kind, slot))
)

// The contexts `getContext()` knows, of which only '2d' is made here:
const contextTypes = ['2d', 'bitmaprenderer', 'webgl', 'webgl2', 'webgpu']

export class OffscreenCanvas {
  #surface
  #width
  #height
  #context = null

  // Transparent black, with a context's defaults. A canvas larger than its
  // pixels may be keeps its size, and has none, as a browser's that couldn't
  // be made.
  constructor(width, height) {
    checkArguments(arguments, 2, 'OffscreenCanvas')
    this.#width = getSize(width)
    this.#height = getSize(height)
    this.#surface = canvas.create(this.#width, this.#height)
    registry?.register(this, ['surface', this.#surface])
  }

  static {
    getCanvasSurface = canvas => canvas.#surface
  }

  // The same 2D context each time, made with the options it's first asked
  // for with; `null` for the other kinds.
  getContext(type, options) {
    checkArguments(arguments, 1, 'getContext')
    type = String(type)
    if (!contextTypes.includes(type)) {
      throw new TypeError(`Invalid context type: '${type}'.`)
    }
    if (type === '2d' && !this.#context) {
      const attributes = getContextAttributes(options)
      if (!attributes.alpha) {
        canvas.setOpaque.call(this.#surface)
      }
      this.#context = new OffscreenCanvasRenderingContext2D(
        internal,
        this,
        this.#surface,
        attributes
      )
    }
    return type === '2d' ? this.#context : null
  }

  get width() {
    return this.#width
  }

  // Cleared to the new size, its state reset, as in browsers:
  set width(width) {
    this.#width = getSize(width)
    canvas.resize.call(this.#surface, this.#width, this.#height)
  }

  get height() {
    return this.#height
  }

  set height(height) {
    this.#height = getSize(height)
    canvas.resize.call(this.#surface, this.#width, this.#height)
  }

  // A PNG, JPEG or WebP file of the canvas, PNG for other types:
  async convertToBlob({ type = 'image/png', quality } = {}) {
    if (this.#width === 0 || this.#height === 0) {
      throw new DOMException(
        'Invalid convertToBlob(): a canvas of no size.',
        'IndexSizeError'
      )
    }
    const [bytes, kind] = canvas.encode.call(
      this.#surface,
      String(type),
      quality
    )
    return new globalThis.Blob([bytes], { type: kind })
  }

  // What the canvas shows, as an `ImageBitmap`, the canvas cleared:
  transferToImageBitmap() {
    if (!this.#context) {
      throw new DOMException(
        'Invalid transferToImageBitmap(): the canvas has no context.',
        'InvalidStateError'
      )
    }
    const bitmap = new ImageBitmap(
      internal,
      canvas.createImageBitmap(this.#surface)
    )
    canvas.clear.call(this.#surface)
    return bitmap
  }
}

let getContextSurface

export class OffscreenCanvasRenderingContext2D {
  #canvas
  #surface
  #attributes

  constructor(key, offscreen, surface, attributes) {
    checkInternal(
      key,
      'OffscreenCanvasRenderingContext2D',
      'getContext() makes them'
    )
    this.#canvas = offscreen
    this.#surface = surface
    this.#attributes = attributes
  }

  static {
    getContextSurface = context => context.#surface
  }

  get canvas() {
    return this.#canvas
  }

  getContextAttributes() {
    return { ...this.#attributes }
  }

  measureText(text) {
    checkArguments(arguments, 1, 'measureText')
    text = String(text)
    const settings = Object.fromEntries(
      [...textSettings, 'textAlign', 'textBaseline'].map(key => [
        key,
        this[key]
      ])
    )
    return new TextMetrics(
      internal,
      canvas.methods.measureText.call(this.#surface, text),
      text,
      settings
    )
  }

  fillTextCluster(cluster, x, y, options) {
    checkArguments(arguments, 3, 'fillTextCluster')
    drawCluster(this, 'fillText', cluster, x, y, options)
  }

  strokeTextCluster(cluster, x, y, options) {
    checkArguments(arguments, 3, 'strokeTextCluster')
    drawCluster(this, 'strokeText', cluster, x, y, options)
  }

  // Transparent black, of a size, either way round, or of another
  // `ImageData`'s.
  createImageData(widthOrImage, height) {
    checkArguments(arguments, 1, 'createImageData')
    if (widthOrImage instanceof ImageData) {
      return new ImageData(widthOrImage.width, widthOrImage.height)
    } else {
      checkArguments(arguments, 2, 'createImageData')
      return new ImageData(
        Math.abs(getLong(widthOrImage)),
        Math.abs(getLong(height))
      )
    }
  }

  getImageData(x, y, width, height) {
    checkArguments(arguments, 4, 'getImageData')
    const args = [x, y, width, height].map(getLong)
    if (args[2] === 0 || args[3] === 0) {
      throw new DOMException(
        'Invalid getImageData(): the width and height must not be 0.',
        'IndexSizeError'
      )
    }
    return canvas.methods.getImageData.call(this.#surface, ...args)
  }

  putImageData(image, ...args) {
    checkOverloads(arguments, [3, 7], 'putImageData')
    if (!(image instanceof ImageData)) {
      throw new TypeError('Invalid putImageData(): not an ImageData.')
    }
    return canvas.methods.putImageData.call(
      this.#surface,
      image,
      ...args.slice(0, arguments.length === 3 ? 2 : 6).map(getLong)
    )
  }

  createLinearGradient(x0, y0, x1, y1) {
    checkArguments(arguments, 4, 'createLinearGradient')
    return createGradient('linear', x0, y0, x1, y1)
  }

  createRadialGradient(x0, y0, r0, x1, y1, r1) {
    checkArguments(arguments, 6, 'createRadialGradient')
    return createGradient('radial', x0, y0, r0, x1, y1, r1)
  }

  createConicGradient(angle, x, y) {
    checkArguments(arguments, 3, 'createConicGradient')
    return createGradient('conic', angle, x, y)
  }

  // `null` for an image that is still loading, as in browsers:
  createPattern(image, repetition) {
    checkArguments(arguments, 2, 'createPattern')
    if (isLoading(image)) {
      return null
    }
    return new CanvasPattern(
      internal,
      canvas.createPattern(getSurface(image), repetition)
    )
  }

  // Nothing for an image that is still loading, as in browsers:
  drawImage(image, ...args) {
    checkOverloads(arguments, [3, 5, 9], 'drawImage')
    if (!isLoading(image)) {
      canvas.methods.drawImage.call(this.#surface, getSurface(image), ...args)
    }
  }

  // The path first, `null` for the current one:
  fill(...args) {
    return callWithPath(this.#surface, 'fill', args, 0, true)
  }

  stroke(...args) {
    return callWithPath(this.#surface, 'stroke', args, 0)
  }

  clip(...args) {
    return callWithPath(this.#surface, 'clip', args, 0, true)
  }

  isPointInPath(...args) {
    return callWithPath(this.#surface, 'isPointInPath', args, 2, true)
  }

  isPointInStroke(...args) {
    return callWithPath(this.#surface, 'isPointInStroke', args, 2)
  }

  roundRect(x, y, w, h, radii) {
    checkArguments(arguments, 4, 'roundRect')
    const args = getRoundRect(x, y, w, h, radii)
    if (args) canvas.methods.roundRect.call(this.#surface, ...args)
  }
}

// What the context does with numbers and text alone, and how many arguments
// each needs, or the counts of its overloads:
const contextMethods = {
  beginPath: 0,
  closePath: 0,
  moveTo: 2,
  lineTo: 2,
  bezierCurveTo: 6,
  quadraticCurveTo: 4,
  arc: 5,
  arcTo: 5,
  ellipse: 7,
  rect: 4,
  fillRect: 4,
  strokeRect: 4,
  clearRect: 4,
  fillText: 3,
  strokeText: 3,
  translate: 2,
  rotate: 1,
  scale: 2,
  transform: 6,
  setTransform: [0, 1, 6],
  resetTransform: 0,
  getTransform: 0,
  save: 0,
  restore: 0,
  reset: 0,
  setLineDash: 1,
  getLineDash: 0
}

// The methods that take only numbers, which WebIDL converts all before the
// method looks at any of them:
const numberMethods = new Set([
  'moveTo',
  'lineTo',
  'bezierCurveTo',
  'quadraticCurveTo',
  'arc',
  'arcTo',
  'ellipse',
  'rect',
  'fillRect',
  'strokeRect',
  'clearRect',
  'translate',
  'rotate',
  'scale',
  'transform'
])

for (const [name, counts] of Object.entries(contextMethods)) {
  inject(OffscreenCanvasRenderingContext2D.prototype, {
    [name](...args) {
      checkOverloads(args, counts, name)
      return canvas.methods[name].call(
        getContextSurface(this),
        ...getArguments(name, args, counts)
      )
    }
  })
}

// Its properties, with the slot of a gradient or a pattern given as a style:
for (const name of canvas.properties) {
  inject(
    OffscreenCanvasRenderingContext2D.prototype,
    {
      get [name]() {
        return canvas.get.call(getContextSurface(this), name)
      },

      set [name](value) {
        canvas.set.call(getContextSurface(this), name, value, getPaint(value))
      }
    },
    { enumerable: true }
  )
}

export class ImageData {
  #data
  #width
  #height

  // `new ImageData(width, height)`, transparent black, or
  // `new ImageData(data, width[, height])` of RGBA `data`, not premultiplied.
  constructor(dataOrWidth, width, height) {
    checkArguments(arguments, 2, 'ImageData')
    if (dataOrWidth instanceof Uint8ClampedArray) {
      const data = dataOrWidth
      const pixels = data.length / 4
      if (!Number.isInteger(pixels) || pixels === 0) {
        throw new DOMException(
          'Invalid ImageData: the data is not whole pixels of 4 bytes.',
          'InvalidStateError'
        )
      }
      width = getSide(width)
      const rows = pixels / width
      if (
        !Number.isInteger(rows) ||
        height !== undefined && getSide(height) !== rows
      ) {
        throw new DOMException(
          'Invalid ImageData: the data is not width × height × 4 bytes.',
          'IndexSizeError'
        )
      }
      height = rows
      this.#data = data
    } else {
      // `(width, height)`:
      height = getSide(width)
      width = getSide(dataOrWidth)
      this.#data = new Uint8ClampedArray(width * height * 4)
    }
    this.#width = width
    this.#height = height
  }

  get width() {
    return this.#width
  }

  get height() {
    return this.#height
  }

  get data() {
    return this.#data
  }

  get colorSpace() {
    return 'srgb'
  }

  get pixelFormat() {
    return 'rgba-unorm8'
  }
}

// A path to fill, stroke, clip with or test points against, in its own
// coordinates, from another `Path2D` or SVG path data.
export class Path2D {
  #path

  constructor(path) {
    this.#path = canvas.createPath(
      path instanceof Path2D
        ? path.#path
        : path === undefined
          ? null
          : String(path)
    )
    registry?.register(this, ['path', this.#path])
  }

  static {
    getPath = path => (path instanceof Path2D ? path.#path : undefined)
  }

  roundRect(x, y, w, h, radii) {
    checkArguments(arguments, 4, 'roundRect')
    const args = getRoundRect(x, y, w, h, radii)
    if (args) canvas.pathMethods.roundRect.call(this.#path, ...args)
  }

  addPath(path, transform) {
    checkArguments(arguments, 1, 'addPath')
    canvas.pathMethods.addPath.call(this.#path, getPath(path), transform)
  }
}

for (const name of [
  'closePath',
  'moveTo',
  'lineTo',
  'bezierCurveTo',
  'quadraticCurveTo',
  'arc',
  'arcTo',
  'ellipse',
  'rect'
]) {
  const counts = contextMethods[name]
  inject(Path2D.prototype, {
    [name](...args) {
      checkOverloads(args, counts, name)
      return canvas.pathMethods[name].call(
        getPath(this),
        ...getArguments(name, args, counts)
      )
    }
  })
}

// Decoded images, or copies of an `ImageData`, a canvas or another bitmap, as
// `createImageBitmap()` makes them, to draw with `drawImage()` and
// `createPattern()`; `close()` frees its pixels.
export class ImageBitmap {
  #surface

  constructor(key, surface) {
    checkInternal(key, 'ImageBitmap', 'createImageBitmap() makes them')
    this.#surface = surface
    registry?.register(this, ['surface', surface], this)
  }

  static {
    // Drawing a closed bitmap throws, as in browsers.
    getBitmapSurface = bitmap => {
      if (bitmap.#surface === null) {
        throw new DOMException(
          'the image bitmap is closed',
          'InvalidStateError'
        )
      }
      return bitmap.#surface
    }
  }

  // None once it's closed:
  get width() {
    return this.#surface === null ? 0 : canvas.width.call(this.#surface)
  }

  get height() {
    return this.#surface === null ? 0 : canvas.height.call(this.#surface)
  }

  close() {
    if (this.#surface !== null) {
      registry?.unregister(this)
      canvas.release('surface', this.#surface)
      this.#surface = null
    }
  }
}

// `<img>` without a document, `new Image()`: setting its `src` loads it through
// `fetch()`, relative to the script's `location`, and decodes it as
// `createImageBitmap()` does, then fires `load`, or `error` when that fails.
export class HTMLImageElement extends EventTarget {
  #src = ''
  #crossOrigin = null
  #width = null
  #height = null
  // What it loads, once its `src` is set, and what that gave:
  #loading = null
  #bitmap = null
  #isBroken = false

  constructor(key) {
    checkInternal(key, 'HTMLImageElement', 'new Image() makes them')
    super()
  }

  static {
    getImageBitmap = image => {
      if (image.#isBroken) {
        throw new DOMException(
          'Invalid image: it could not be decoded.',
          'InvalidStateError'
        )
      }
      return image.#bitmap
    }
  }

  get src() {
    return this.#src
  }

  // Resolved as browsers resolve it, and loaded:
  set src(src) {
    src = String(src)
    this.#src = src && new URL(src, globalThis.location?.href).href
    this.#bitmap = null
    this.#isBroken = false
    const loading = (this.#loading = this.#src ? this.#load(this.#src) : null)
    loading?.then(
      bitmap => {
        if (this.#loading === loading) {
          this.#bitmap = bitmap
          this.dispatchEvent(new Event('load'))
        }
      },
      () => {
        if (this.#loading === loading) {
          this.#isBroken = true
          this.dispatchEvent(new Event('error'))
        }
      }
    )
  }

  get currentSrc() {
    return this.#bitmap ? this.#src : ''
  }

  get crossOrigin() {
    return this.#crossOrigin
  }

  // Kept, as there's no CORS outside a browser:
  set crossOrigin(crossOrigin) {
    this.#crossOrigin = crossOrigin == null ? null : String(crossOrigin)
  }

  // Loaded or broken, or without a `src`:
  get complete() {
    return !this.#src || !!this.#bitmap || this.#isBroken
  }

  get naturalWidth() {
    return this.#bitmap?.width ?? 0
  }

  get naturalHeight() {
    return this.#bitmap?.height ?? 0
  }

  // As it's drawn, which is its natural size unless set:
  get width() {
    return this.#width ?? this.naturalWidth
  }

  set width(width) {
    this.#width = Math.max(0, Math.trunc(width) || 0)
  }

  get height() {
    return this.#height ?? this.naturalHeight
  }

  set height(height) {
    this.#height = Math.max(0, Math.trunc(height) || 0)
  }

  // A Promise that it has loaded, rejected with an `EncodingError` when it
  // can't be:
  async decode() {
    await this.#loading?.catch(() => {})
    if (!this.#bitmap) {
      throw new DOMException(
        `Invalid image: '${this.#src}' could not be decoded.`,
        'EncodingError'
      )
    }
  }

  async #load(src) {
    const response = await globalThis.fetch(src)
    if (!response.ok) {
      throw new TypeError(`'${src}' answered ${response.status}`)
    }
    return createImageBitmap(await response.blob())
  }
}

defineEventHandlers(HTMLImageElement.prototype, 'load', 'error')

// `new Image(width, height)`, as browsers make an `<img>`.
export function Image(width, height) {
  if (!new.target) {
    throw new TypeError("Invalid Image(): use 'new Image()'.")
  }
  const image = new HTMLImageElement(internal)
  if (width !== undefined) image.width = width
  if (height !== undefined) image.height = height
  return image
}

Image.prototype = HTMLImageElement.prototype

export class CanvasGradient {
  #paint

  constructor(key, paint) {
    checkInternal(key, 'CanvasGradient', 'the context makes them')
    this.#paint = paint
    registry?.register(this, ['paint', paint])
  }

  static {
    getGradientPaint = gradient => gradient.#paint
  }

  addColorStop(offset, color) {
    checkArguments(arguments, 2, 'addColorStop')
    canvas.addColorStop.call(this.#paint, getFinite(offset), color)
  }
}

export class CanvasPattern {
  #paint

  constructor(key, paint) {
    checkInternal(key, 'CanvasPattern', 'the context makes them')
    this.#paint = paint
    registry?.register(this, ['paint', paint])
  }

  static {
    getPatternPaint = pattern => pattern.#paint
  }

  setTransform(transform = {}) {
    const { a, b, c, d, e, f } = DOMMatrix.fromMatrix(transform)
    canvas.setPatternTransform.call(this.#paint, a, b, c, d, e, f)
  }
}

export { TextCluster, TextMetrics }

defineInterfaces(
  OffscreenCanvas,
  OffscreenCanvasRenderingContext2D,
  ImageData,
  Path2D,
  ImageBitmap,
  HTMLImageElement,
  CanvasGradient,
  CanvasPattern
)

// A Promise of an `ImageBitmap` of `image` (a `Blob`, an `ImageData`, an image,
// a canvas or an `ImageBitmap`), cropped, flipped and resized as asked.
export async function createImageBitmap(image, ...args) {
  if (isLoading(image)) {
    throw new DOMException(
      'Invalid image: it is still loading.',
      'InvalidStateError'
    )
  }
  const source =
    image instanceof globalThis.Blob
      ? new Uint8Array(await image.arrayBuffer())
      : image instanceof ImageData
        ? image
        : getSurface(image)
  return new ImageBitmap(internal, canvas.createImageBitmap(source, ...args))
}

// Is `image` an image whose `src` is still loading?
function isLoading(image) {
  return image instanceof HTMLImageElement && !image.complete
}

// The surface of a canvas, a bitmap or a loaded image.
function getSurface(image) {
  if (image instanceof OffscreenCanvas) {
    if (image.width === 0 || image.height === 0) {
      throw new DOMException(
        'Invalid image: a canvas of no size.',
        'InvalidStateError'
      )
    }
    return getCanvasSurface(image)
  } else if (image instanceof ImageBitmap) {
    return getBitmapSurface(image)
  } else if (image instanceof HTMLImageElement) {
    const bitmap = getImageBitmap(image)
    if (!bitmap) {
      throw new DOMException(
        'Invalid image: it has no src.',
        'InvalidStateError'
      )
    }
    return getBitmapSurface(bitmap)
  } else {
    throw new TypeError(
      `Invalid image: '${image}', not an image, canvas or bitmap.`
    )
  }
}

// The slot of a gradient or a pattern given as a style, or nothing.
function getPaint(style) {
  return style instanceof CanvasGradient
    ? getGradientPaint(style)
    : style instanceof CanvasPattern
      ? getPatternPaint(style)
      : undefined
}

function createGradient(kind, ...args) {
  return new CanvasGradient(internal, canvas.createGradient(kind, ...args))
}

// `name(path, …)` of the context, with the path's slot first: `null` without
// one, for the current path; `count` arguments after the path are needed.
// With `hasFillRule`, the argument after the `count` it needs is a fill rule,
// which the call without a path takes only if it gets no more than that.
function callWithPath(surface, name, args, count, hasFillRule) {
  const path = args[0] instanceof Path2D ? getPath(args.shift()) : null
  checkArguments(args, count, name)
  if (hasFillRule) {
    if (!path && args.length > count + 1) {
      throw new TypeError(`Invalid ${name}(): ${args.length} arguments.`)
    }
    args[count] = getFillRule(args[count])
  }
  return canvas.methods[name].call(surface, path, ...args)
}

// The arguments of the method `name`, its numbers converted first.
function getArguments(name, args, count) {
  return numberMethods.has(name)
    ? args.map((arg, index) => (index < count ? Number(arg) : arg))
    : args
}

// A `CanvasFillRule`, as WebIDL converts an enumeration: from text, or a
// `TypeError`.
function getFillRule(value = 'nonzero') {
  const rule = String(value)
  if (rule !== 'nonzero' && rule !== 'evenodd') {
    throw new TypeError(`Invalid fill rule: '${rule}'.`)
  }
  return rule
}

// A `TypeError` unless `name()` got as many arguments as it needs, or, for an
// overloaded one, as one of its overloads takes, WebIDL's way: with more than
// the most, the most.
function checkOverloads(args, counts, name) {
  if (typeof counts === 'number') {
    checkArguments(args, counts, name)
  } else {
    const count = Math.min(args.length, Math.max(...counts))
    if (!counts.includes(count) || count === 1 && !isObject(args[0])) {
      throw new TypeError(`Invalid ${name}(): ${args.length} arguments.`)
    }
  }
}

function isObject(value) {
  return value !== null && typeof value === 'object'
}

// A canvas's width or height, as WebIDL's `[EnforceRange] unsigned long
// long` takes it: a whole number from 0, from text too (`'0x96'`).
function getSize(value) {
  const size = Math.trunc(Number(value))
  if (!(size >= 0 && size <= Number.MAX_SAFE_INTEGER)) {
    throw new TypeError(`Invalid canvas size: '${value}'.`)
  }
  return size
}

// The rectangle and the horizontal and vertical radii of its top-left,
// top-right, bottom-right and bottom-left corners as it shows, for
// `roundRect()`: `radii` a number, a `DOMPointInit` or a list of one to four of
// them, as CSS's `border-radius` takes them. Nothing for values that aren't
// finite, which draw nothing.
function getRoundRect(x, y, w, h, radii = 0) {
  const list =
    isObject(radii) && typeof radii[Symbol.iterator] === 'function'
      ? Array.from(radii)
      : [radii]
  if (list.length < 1 || list.length > 4) {
    throw new RangeError(
      `Invalid roundRect() radii: ${list.length}, not 1 to 4.`
    )
  }
  const corners = list.map(radius => {
    const { x: rx = 0, y: ry = 0 } =
      isObject(radius) || radius === undefined
        ? radius ?? {}
        : { x: radius, y: radius }
    return [+rx, +ry]
  })
  const numbers = [+x, +y, +w, +h, ...corners.flat()]
  if (!numbers.every(Number.isFinite)) return null
  if (corners.flat().some(r => r < 0)) {
    throw new RangeError('Invalid roundRect() radius: it is negative.')
  }
  // Top-left, top-right, bottom-right, bottom-left, as the list gives them:
  const [a, b = a, c = a, d = b] = corners
  let [ul, ur, lr, ll] = corners.length === 3 ? [a, b, c, b] : [a, b, c, d]
  // Where the width or height is negative, the corners show swapped:
  if (w < 0) [ul, ur, lr, ll] = [ur, ul, ll, lr]
  if (h < 0) [ul, ur, lr, ll] = [ll, lr, ur, ul]
  return [+x, +y, +w, +h, ...ul, ...ur, ...lr, ...ll]
}

// A 2D context's settings; options that aren't an object are none, as in
// browsers. The canvas draws in sRGB whatever `colorSpace` says.
function getContextAttributes(options) {
  const {
    alpha = true,
    colorSpace = 'srgb',
    desynchronized = false,
    willReadFrequently = false
  } = isObject(options) ? options : {}
  if (colorSpace !== 'srgb' && colorSpace !== 'display-p3') {
    throw new TypeError(`Invalid color space: '${colorSpace}'.`)
  }
  return {
    alpha: !!alpha,
    colorSpace,
    desynchronized: !!desynchronized,
    willReadFrequently: !!willReadFrequently
  }
}

// A number as WebIDL's `double` takes it: a `TypeError` unless it's finite.
function getFinite(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) {
    throw new TypeError(`Invalid number: '${value}'.`)
  }
  return number
}

// A number as WebIDL's `[EnforceRange] long` takes it.
function getLong(value) {
  return getInteger(value, -(2 ** 31), 2 ** 31 - 1)
}

// A whole number from `min` to `max`, as `[EnforceRange]` converts it: a
// `TypeError` for anything else.
function getInteger(value, min, max) {
  const number = Math.trunc(Number(value))
  if (!(number >= min && number <= max)) {
    throw new TypeError(`Invalid integer: '${value}'.`)
  }
  return number
}

// A side of an `ImageData`, as WebIDL's `[EnforceRange] unsigned long`: a
// whole number of pixels, more than none.
function getSide(value) {
  const side = getInteger(value, 0, 2 ** 32 - 1)
  if (side === 0) {
    throw new DOMException(
      `Invalid ImageData size: '${value}'.`,
      'IndexSizeError'
    )
  }
  return side
}
