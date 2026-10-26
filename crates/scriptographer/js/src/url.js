import {
  checkArguments,
  inject,
  defineInterfaces,
  toUSVString
} from './define.js'
import { natives } from './natives.js'
import { definePairIterable, getPairs, setFirst } from './pairs.js'

// `URL` and `URLSearchParams` for scripts outside a browser, as the WHATWG URL
// standard has them: the runtime parses, and sets the parts. `url.searchParams`
// and its URL stay in step both ways.

// The parts scripts set, as the origin follows them:
const parts = [
  'protocol',
  'username',
  'password',
  'host',
  'hostname',
  'port',
  'pathname',
  'search',
  'hash'
]

// What `URLSearchParams` and `URL` reach of each other:
let setPairs
let setSearch

export class URL {
  // The parts as the runtime parsed them:
  #parts
  #searchParams = null

  constructor(url, base = undefined) {
    checkArguments(arguments, 1, 'URL')
    this.#parts = parse(url, base)
    if (!this.#parts) {
      throw new TypeError(`Invalid URL: '${url}'.`)
    }
  }

  static {
    setSearch = (url, query) => {
      url.#parts = natives.url.set(url.#parts.href, 'search', query)
    }
  }

  static canParse(url, base = undefined) {
    checkArguments(arguments, 1, 'canParse')
    return !!parse(url, base)
  }

  static parse(url, base = undefined) {
    checkArguments(arguments, 1, 'parse')
    return parse(url, base) ? new URL(url, base) : null
  }

  get href() {
    return this.#parts.href
  }

  set href(href) {
    this.#set('href', toUSVString(href))
  }

  get origin() {
    return this.#parts.origin
  }

  get searchParams() {
    if (!this.#searchParams) {
      this.#searchParams = new URLSearchParams(this.#parts.search)
      linksByParams.set(this.#searchParams, this)
    }
    return this.#searchParams
  }

  toString() {
    return this.#parts.href
  }

  toJSON() {
    return this.#parts.href
  }

  // Set a part, and the search params follow.
  #set(part, value) {
    this.#parts = natives.url.set(this.#parts.href, part, String(value))
    if (this.#searchParams) {
      setPairs(this.#searchParams, parseQuery(this.#parts.search))
    }
  }

  static {
    for (const part of parts) {
      inject(
        URL.prototype,
        {
          get [part]() {
            return this.#parts[part]
          },

          set [part](value) {
            this.#set(part, toUSVString(value))
          }
        },
        { enumerable: true }
      )
    }
  }
}

// The URL that `URLSearchParams` belong to, which they change:
const linksByParams = new WeakMap()

export class URLSearchParams {
  #pairs = []

  // A query string (with or without `?`), `[[name, value], …]` or anything
  // iterable of pairs, as `URLSearchParams` are, or `{ name: value }`.
  constructor(init = '') {
    if (
      init !== null &&
      (typeof init === 'object' || typeof init === 'function')
    ) {
      // A record's names can be the same once they're USVStrings: the last value
      // wins, in the first one's place.
      const pairs = getPairs(init).map(pair => pair.map(toUSVString))
      this.#pairs =
        typeof init[Symbol.iterator] === 'function'
          ? pairs
          : [...new Map(pairs)]
    } else {
      this.#pairs = parseQuery(toUSVString(init))
    }
  }

  static {
    setPairs = (params, pairs) => {
      params.#pairs = pairs
    }
  }

  get size() {
    return this.#pairs.length
  }

  append(name, value) {
    checkArguments(arguments, 2, 'append')
    this.#pairs.push([toUSVString(name), toUSVString(value)])
    this.#update()
  }

  delete(name, value = undefined) {
    checkArguments(arguments, 1, 'delete')
    name = toUSVString(name)
    this.#pairs = this.#pairs.filter(
      pair => (
        pair[0] !== name ||
        value !== undefined && pair[1] !== toUSVString(value)
      )
    )
    this.#update()
  }

  get(name) {
    checkArguments(arguments, 1, 'get')
    name = toUSVString(name)
    return this.#pairs.find(pair => pair[0] === name)?.[1] ?? null
  }

  getAll(name) {
    checkArguments(arguments, 1, 'getAll')
    name = toUSVString(name)
    return this.#pairs
      .filter(pair => pair[0] === name)
      .map(([, value]) => value)
  }

  has(name, value = undefined) {
    checkArguments(arguments, 1, 'has')
    name = toUSVString(name)
    return this.#pairs.some(
      pair => (
        pair[0] === name &&
        (value === undefined || pair[1] === toUSVString(value))
      )
    )
  }

  set(name, value) {
    checkArguments(arguments, 2, 'set')
    this.#pairs = setFirst(this.#pairs, [toUSVString(name), toUSVString(value)])
    this.#update()
  }

  // By name, in UTF-16 code units, as strings compare: stable.
  sort() {
    this.#pairs.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    this.#update()
  }

  // By index over the pairs as they are at each step, so what changes while
  // they're iterated shows:
  *entries() {
    for (let i = 0; i < this.#pairs.length; i++) {
      const [name, value] = this.#pairs[i]
      yield [name, value]
    }
  }

  toString() {
    return natives.url.serializeQuery(this.#pairs)
  }

  // The URL they belong to follows.
  #update() {
    const url = linksByParams.get(this)
    if (url) setSearch(url, this.toString())
  }
}

definePairIterable(URLSearchParams)
defineInterfaces(URL, URLSearchParams)

// The parts of `url`, against `base` when it's given, or `null`.
function parse(url, base) {
  return base === undefined
    ? natives.url.parse(toUSVString(url))
    : natives.url.parse(toUSVString(url), toUSVString(base))
}

function parseQuery(query) {
  return natives.url.parseQuery(query.replace(/^\?/, ''))
}
