// Defining classes as the realm defines its own, and as WebIDL has them.

// Inject the properties of `source` into `target`, getters and setters too:
// not enumerable, as the realm's own methods aren't, unless `attributes` say
// otherwise.
export function inject(target, source, attributes) {
  for (const key of Reflect.ownKeys(source)) {
    Object.defineProperty(target, key, {
      ...Object.getOwnPropertyDescriptor(source, key),
      enumerable: false,
      ...attributes
    })
  }
  return target
}

// The `constants` of `Class`, on it and its prototype.
export function defineConstants(Class, constants) {
  for (const target of [Class, Class.prototype]) {
    inject(target, constants, {
      enumerable: true,
      writable: false,
      configurable: false
    })
  }
}

// Make `classes` interfaces as WebIDL has them: their attributes and operations
// enumerable, on the prototype and the static ones, and their instances named as
// the realm's own are, in `Object.prototype.toString()`: `[object Blob]`.
export function defineInterfaces(...classes) {
  for (const Class of classes) {
    for (const [target, skipped] of [
      [Class.prototype, ['constructor']],
      [Class, ['length', 'name', 'prototype']]
    ]) {
      for (const key of Object.getOwnPropertyNames(target)) {
        if (!skipped.includes(key)) {
          Object.defineProperty(target, key, { enumerable: true })
        }
      }
    }
    inject(
      Class.prototype,
      { [Symbol.toStringTag]: Class.name },
      { writable: false }
    )
  }
}

// What only the runtime's own code passes the classes scripts can't construct:
export const internal = Symbol('internal')

// A `TypeError` unless the runtime's own code constructs the class `name`,
// saying `how` scripts get its instances.
export function checkInternal(key, name, how) {
  if (key !== internal) {
    throw new TypeError(`Invalid ${name}: ${how}.`)
  }
}

// A `TypeError` when `name()` got fewer than `count` arguments.
export function checkArguments(args, count, name) {
  if (args.length < count) {
    throw new TypeError(`Invalid ${name}(): an argument is missing.`)
  }
}
