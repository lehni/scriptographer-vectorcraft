# The natives

What an app gives the bundle, `globalThis.__scriptographer`, which the bundle takes off the global object as it loads (`src/natives.js`), and what the bundle adds to it for the app to call. Both apps implement this contract: VectorCraft in Rust (`crates/scriptographer/src`), Glyphs in Objective-C (`scriptographer-glyphs/src`).

Errors are the realm's: `TypeError`, `RangeError`, or a `DOMException` of the name given. Bytes are `Uint8Array`s. "Delivered" means on the script's next turn, as a unit of its work.

## Loading

1. `self` is the global object, `navigator` has `userAgent`, `language`, `languages` and `hardwareConcurrency`.
2. acorn (`self.acorn`, which PaperScript prefers), then `vendor/paper-hosted.js`.
3. `__scriptographer`, then `dist/scriptographer.js`.
4. The runtime's own globals, after the bundle: `setTimeout`, `setInterval`, `clearTimeout`, `clearInterval`, `requestAnimationFrame`, `cancelAnimationFrame`, and `structuredClone` (see Clone).
5. Per script: `setScript(file, directory, preferences)`, which gives it `script` (see below), and `setLocation(href)`, the script's file URL.

Scripts run through the bundle's `executeScript(scope, source, url)`, with `url` the script's file URL (or a name, for code without a file), which loads what they `import` (see Modules) and keeps the handlers they export, `onStartup`, `onShutdown`, `onStop`, `onAppActivate`, `onAppDeactivate` and `onEditOptions`; the app calls them with `callHandler(name)`. A script runs in a realm of its own.

## Required as the bundle loads

- `print(text)`: one console line, indented already.
- `canvas.properties`, `canvas.release`.

## Core

- `now()`: milliseconds since the realm started.
- `random(length)`: that many random bytes, 65536 at most.
- `readModule(url)`: the text of the module at a `file:`, `http:` or `https:` URL, synchronously, as `import` needs it; downloads may come from the app's cache. Throws when it can't.
- `evaluate(source, url)`, optional: what `source` evaluates to as a script of `url`, so that stack traces name the scripts' code in their files.
- `encoding.encode(text)`: UTF-8. `encoding.decode(bytes, fatal)`: UTF-8 as browsers decode it, invalid sequences as U+FFFD, or `null` when `fatal`.
- `ask(question)`, synchronous; it may return a Promise:
  - `{ type: 'alert' | 'confirm', title, message }`: `true` for OK, `false`/`null` otherwise.
  - `{ type: 'prompt', title, components }`: the values by name, or `null`. See Components.
  - `{ type: 'clipboardRead' }`: `{ text }`. `{ type: 'clipboardWrite', text }`.
  - `{ type: 'openFile' | 'openFiles' | 'saveFile' | 'chooseDirectory', path, filters }`: a path, paths, or `null`. `path` is where the picker starts, `filters` `[description, extensions]`, one without extensions showing all.

## Storage

`storage.getItem(session, key)` (`null` when missing), `setItem(session, key, value)`, `removeItem(session, key)`, `clear(session)`, `keys(session)`, in the order items were set. `session` is `sessionStorage`; `localStorage` is kept per script file.

## Files (optional: enables `LocalFile`, the file pickers, `navigator.storage` and `file:` fetches)

By path; a relative path is from the script's folder.

- `fs.path(...parts)`, `fs.info(path)`: `{ name, parent, extension, exists, isDirectory, size, lastModified }`.
- `fs.fromURL(url)`: a `file:` URL's path, else a `TypeError`.
- `fs.read(path)`, `fs.write(path, bytes, append)`, `fs.list(path)` (sorted paths), `fs.makeDirectory(path, recursive)`, `fs.remove(path, recursive)`, `fs.rename(path, nameOrPath)` (a name renames in place; gives the new path), `fs.copy(from, to)`, `fs.relative(directory, path)` (the names down to it, or `null`).
- `fs.userDirectory(name)`: `desktop`, `documents`, `downloads`, `music`, `pictures`, `videos`.
- `fs.privateDirectory()`: the script's own folder, made when missing; `null` without one. `fs.usage()`: its bytes, files and `localStorage`.
- Failures: `NotFoundError`, `NotAllowedError`, `InvalidModificationError` (writes) or `NotReadableError` (reads).

## Network and the rest (each delivers through a callback; open ones keep the script running)

- `fetch.request(method, url, headers, body, follow, receive)`: a number. `receive` gets the head `{ status, statusText, url, redirected, headers }`, then the body as bytes, then `null`; a string when it failed. `fetch.cancel(number)`, also after the response ended.
- `socket.open(url, protocols, receive)`, `socket.send(number, bytesOrText)`, `socket.close(number, code, reason)`. `receive` gets `{ type: 'open', protocol }`, `{ type: 'message', data }`, `{ type: 'error', message }`, `{ type: 'close', code, reason, wasClean }`.
- `eventSource.open(url, receive)`, `eventSource.close(number)`. The stream is read as the HTML standard parses it, and connected again after the reconnection time (3000 ms, or `retry`), with `Last-Event-ID`. `receive` gets `{ state: 'open', url }`, `{ state: 'event', type, data, lastEventId }`, `{ state: 'reconnecting' }`, `{ state: 'failed', reason }`.
- `compression.open(format, decompress)`: `gzip`, `deflate`, `deflate-raw`, `brotli`. `compression.write(number, bytes)`: `[bytes, failure]`. `compression.finish(number)`: the rest, or a `TypeError` for data that didn't end. `compression.close(number)`. 512 MB at most.
- `url.parse(url[, base])`: `{ href, origin, protocol, username, password, host, hostname, port, pathname, search, hash }` as the WHATWG URL standard parses it, or `null`. `url.set(href, part, value)`: the parts once set as its setter sets it. `url.parseQuery(query)`: `[name, value]` pairs. `url.serializeQuery(pairs)`.
- `broadcast.open(name, receive)`, `broadcast.post(number, message)`, `broadcast.close(number)`: to the other channels of that name, in all of the app's scripts, as structured serialization keeps it.
- `locks.request(name, exclusive, ifAvailable, steal, receive)`: `[number, 'granted' | 'waiting' | 'unavailable']`; later `receive('granted' | 'stolen')`. `locks.release(number)`, `locks.cancel(number)`, `locks.query()`: `{ held, pending }` of `{ name, mode, clientId }`. Across all scripts; a stopped script lets go of its locks.
- `port.channel()`: two numbers. `port.post(number, message, ports, numbers, buffers)`, `port.start(number, receive)`, `port.close(number)`. A port sent in a transfer list moves to the realm that receives it, which numbers it with `makePort()`.
- `worker.start(url, name, receive)`, `worker.post(number, data, ports, numbers, buffers)`, `worker.terminate(number)`, `worker.connect(url, name, port, onError)`, and in a worker `worker.self.postMessage(data, ports, numbers, buffers)`, `worker.self.close()`, `worker.self.importScripts(...paths)`. A worker runs a classic script on a thread of its own, in a realm with the same APIs and Paper.js, but no document; `receive` gets `{ type, data, ports }` or `{ type: 'error', message }`. A shared worker is one per URL and name for all scripts.
- `effects.define(type, label, parametersJSON)`, `effects.forget(type)`: the effects a script defines (VectorCraft).
- `dom()`, optional: a linkedom window.

## Canvas

Each `OffscreenCanvas`, `ImageBitmap`, `Path2D`, `CanvasGradient` and `CanvasPattern` keeps the number of its slot; the methods of a surface or a path are called with its slot as `this`.

- `canvas.create(width, height)`: a surface, transparent black; one larger than 16384 a side or 16384²/4 pixels has none. `width()`, `height()`, `resize(width, height)` (cleared, its state reset), `clear()`, `setOpaque()` (for `alpha: false`: black, and opaque after every change).
- `canvas.encode(type, quality)`: `[bytes, mimeType]`: PNG, or JPEG (on black, quality 0.92 unless a number from 0 to 1); WebP where the app can, else PNG.
- `canvas.get(name)`, `canvas.set(name, value, paintSlot)`: the 27 `properties`. A value a property can't take changes nothing; colors are serialized as CSS Color 4 says (`#rrggbb`, `rgba(…)`, or a modern color in its own space); the font as its shorthand normalized (`bold 16px "Helvetica Neue"`).
- `canvas.methods.*`: the 2D context's: paths (points through the current transform as they're added), `fill`/`stroke`/`clip`/`isPointInPath`/`isPointInStroke` with a path slot or `null` first, `fillRect`/`strokeRect`/`clearRect`, `fillText`/`strokeText`/`measureText`, `drawImage(surfaceSlot, …3, 5 or 9 numbers)`, `getImageData` (an `ImageData`, not premultiplied), `putImageData`, transforms (`getTransform` a `DOMMatrix`), `save`/`restore`/`reset`, `setLineDash`/`getLineDash`.
- `measureText(text)`: `width`, `actualBoundingBox{Left,Right,Ascent,Descent}`, `fontBoundingBox{Ascent,Descent}`, `emHeight{Ascent,Descent}`, `{hanging,alphabetic,ideographic}Baseline`, all from the anchor `textAlign` and `textBaseline` choose, and `clusters`, a `Float64Array` of 8 numbers per grapheme cluster (UAX #29): UTF-16 start and end, left, advance, ink left and right, top and bottom.
- `canvas.pathMethods.*`: a `Path2D`'s, without a transform; `addPath(pathSlot, transform)`.
- `canvas.createGradient('linear' | 'radial' | 'conic', …numbers)`, `addColorStop(offset, color)` (`this` the paint; interpolated in Oklab once a stop is in modern syntax), `createPattern(surfaceSlot, repetition)` (null is `repeat`), `setPatternTransform(a, b, c, d, e, f)`.
- `canvas.createPath(source)`: empty for `null`, a copy of a path slot, or SVG path data up to its first error.
- `canvas.createImageBitmap(source[, sx, sy, sw, sh][, options])`: from a surface slot, an `ImageData` or image file bytes; cropped, `resizeWidth`/`resizeHeight`, `imageOrientation: 'flipY'`, `resizeQuality: 'pixelated'`.
- `canvas.addFont(bytes)`: the families of a font file, kept for the scripts. `canvas.fontFamilies(font)`. `canvas.setFontFace(name, families, shown)`.
- `canvas.release(kind, slot)`.

## Components (palettes and prompts)

`getComponents()` (`src/dialog.js`) gives `{ name, …definition, value }`, without functions, colors as `#rrggbb`. Types: `number` (`min`, `max` or `range`, `fractionDigits`, `steppers`, `increment`, `units`: point, pica, inch, millimeter, centimeter, percent, degree), `slider`/`range`, `boolean`/`checkbox`, `list` (`options`), `color`, `string` (`multiline`, `rows`), `button`, `text`, `ruler`, and in a palette's menu `menu-entry` and `menu-separator`. All take `label`, `visible`, `enabled`, `fullSize`, `toolTip`, `width`, `length`.

## What the bundle gives the app

- `takePalettes()`: the palettes new or changed since the last call, `{ id, title, components }`. `hasPalettes()`, which keeps a script running. `handlePaletteEvent(id, 'change' | 'click' | 'close', name, value)`.
- `dispatchKey(type, init)`, `hasKeyListeners()`.
- `getSelectedKeys(project)`: the keys of the selected items, as JSON.
- `setScript(file, directory, preferences)`: the global `script`: `file` and `directory` as `LocalFile`s, `keepAlive`, and `preferences` from their JSON (Paper.js's, so Colors and Points come back). `getPreferences()`: their JSON, which the app keeps once a unit of work is done, when it changed. `keepsAlive()`: whether the script set `script.keepAlive`.
- `setLocation(href)`, `setupWorker(name, isShared)` (gives what receives messages or connected ports), `makePort(number)`, `getBytes(blob)`, `getGeometryValues(object)`, `notifyRejections`.
- `watchEffects(Effect)`, `applyEffect(scope, type, parameters, art, key)` (VectorCraft).

## Clone

Structured serialization, which messages and `structuredClone()` use: primitives; objects and arrays deeply (own enumerable properties), shared and cyclic ones kept; `Date`, `RegExp`, `Map`, `Set`, `ArrayBuffer`, typed arrays, `DataView`, the `Error` classes, boxed primitives, `Blob`, `ImageData` and the geometry classes as themselves. Functions, symbols and other objects throw a `DataCloneError`. `structuredClone(value, { transfer })` copies and detaches the buffers it transfers.

## Running

- A script keeps running while it has a tool, `onFrame`, timers, palettes, or open requests, sockets, event sources, channels, started ports, waiting locks or workers.
- Running a script stops the others, unless they set `script.keepAlive`, and leaves the tool's script running. Stopping calls `onStop`.
- `script.preferences` is kept after each unit of work, when it changed.
- A script that works for longer than 5 seconds is asked about: Wait asks again later, Stop ends it.

## Modules

- `import` resolves its specifier against the URL of the importing code, the script's for its own imports, and reads the module with `readModule(url)`; an `http:` or `https:` one shows in the console.
- A `.pjs` module is PaperScript, with operator overloading, any other plain JavaScript, unless the import says which with `with { type: 'paperscript' }` or `with { type: 'javascript' }`.
- Each module runs once per script, per kind, in the script's scope; a cycle throws, and one that failed runs again the next time it's imported.
