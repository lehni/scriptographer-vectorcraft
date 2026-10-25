import { inject } from './define.js'

// What the classes of `[name, value]` pairs share: `Headers`, `FormData` and
// `URLSearchParams`.

// Give `Class` what WebIDL's pair iterators have, from its `entries()`, which is
// its `[Symbol.iterator]()` too.
export function definePairIterable(Class) {
  inject(Class.prototype, pairIterable)
  inject(Class.prototype, { [Symbol.iterator]: Class.prototype.entries })
}

const pairIterable = {
  forEach(callback, thisArg = undefined) {
    for (const [key, value] of this.entries()) {
      callback.call(thisArg, value, key, this)
    }
  },

  *keys() {
    for (const [key] of this.entries()) yield key
  },

  *values() {
    for (const [, value] of this.entries()) yield value
  }
}

// The pairs of `init`: `[[name, value], …]` or `{ name: value }`.
export function getPairs(init) {
  return typeof init[Symbol.iterator] === 'function'
    ? Array.from(init, pair => {
        pair = [...pair]
        if (pair.length !== 2) {
          throw new TypeError(`Invalid pair: '${pair}'.`)
        }
        return pair
      })
    : Object.entries(init)
}

// `entry` in place of the first pair of `list` of its name, the others of the
// name gone, as their `set()` does.
export function setFirst(list, entry) {
  const index = list.findIndex(([name]) => name === entry[0])
  const rest = list.filter(([name]) => name !== entry[0])
  rest.splice(index < 0 ? rest.length : index, 0, entry)
  return rest
}
