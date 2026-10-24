// What scripts see that's written in JavaScript, on every platform. The runtime
// runs it before its own classes, which build on these.
import { natives } from './natives.js'
import { inject, internal } from './define.js'
import * as abort from './abort.js'
import * as blob from './blob.js'
import { BroadcastChannel } from './broadcast-channel.js'
import * as canvas from './canvas.js'
import { dom } from './dom.js'
import { Clipboard } from './clipboard.js'
import { CompressionStream, DecompressionStream } from './compression.js'
import { createConsole } from './console.js'
import { Crypto } from './crypto.js'
import { setupDialog } from './dialog.js'
import { applyEffect, watchEffects } from './effects.js'
import { DOMException } from './dom-exception.js'
import {
  TextDecoder,
  TextDecoderStream,
  TextEncoder,
  TextEncoderStream
} from './encoding.js'
import * as events from './events.js'
import { EventSource } from './event-source.js'
import * as fetch from './fetch.js'
import * as fileSystem from './file-system.js'
import * as geometry from './geometry.js'
import * as globalScope from './global-scope.js'
import * as streams from './streams.js'
import { notifyRejections, reportRejections } from './rejections.js'
import { FontFace, FontFaceSet } from './font-face.js'
import { LocalFile } from './local-file.js'
import { Lock, LockManager } from './locks.js'
import {
  Palette,
  handlePaletteEvent,
  hasPalettes,
  takePalettes
} from './palette.js'
import { Storage, createStorage } from './storage.js'
import { StorageManager } from './storage-manager.js'
import { URL, URLSearchParams } from './url.js'
import { URLPattern } from './url-pattern.js'
import { WebSocket } from './websocket.js'
import { MessageChannel, MessagePort, makePort } from './message-port.js'
import { SharedWorker, Worker, setupWorker } from './worker.js'
import * as xhr from './xhr.js'

delete globalThis.__scriptographer
const { print } = natives

// Its own console, also in a browser's realm, for the script's output:
const console = createConsole(print)
inject(globalThis, { console, print: console.log })

// What a browser's realm has already, it keeps:
inject(
  globalThis,
  Object.fromEntries(
    Object.entries(globalScope).filter(([name]) => !(name in globalThis))
  )
)
if (globalThis.navigator && !navigator.clipboard) {
  inject(globalThis, { Clipboard })
  inject(navigator, { clipboard: new Clipboard() }, { writable: false })
}
if (!globalThis.TextEncoder) {
  inject(globalThis, { TextEncoder, TextDecoder })
}
if (!globalThis.ReadableStream) {
  inject(globalThis, { ...streams })
}
if (!globalThis.CompressionStream) {
  inject(globalThis, { CompressionStream, DecompressionStream })
}
if (!globalThis.TextEncoderStream) {
  inject(globalThis, { TextEncoderStream, TextDecoderStream })
}
if (!globalThis.crypto) {
  inject(globalThis, { Crypto, crypto: new Crypto() })
}
if (!globalThis.DOMException) {
  inject(globalThis, { DOMException })
}
if (!globalThis.EventTarget) {
  const { defineEventHandlers, fire, ...classes } = events
  // The global object is an `EventTarget` too, as a browser's is, whose methods
  // work called bare:
  const { prototype } = classes.EventTarget
  inject(globalThis, {
    ...classes,
    addEventListener: prototype.addEventListener.bind(globalThis),
    removeEventListener: prototype.removeEventListener.bind(globalThis),
    dispatchEvent: prototype.dispatchEvent.bind(globalThis)
  })
  defineEventHandlers(globalThis, 'unhandledrejection', 'rejectionhandled')
  // What the runtime hands the rejections of its calls to:
  Object.assign(natives, { notifyRejections })
} else {
  reportRejections()
}
if (!globalThis.fetch) {
  const { Blob, File, getBytes } = blob
  const { getBody, ...classes } = fetch
  inject(globalThis, { ...abort, Blob, File, ...classes })
  // What the runtime reads of blobs:
  Object.assign(natives, { getBytes })
}
if (!globalThis.XMLHttpRequest) {
  inject(globalThis, { ...xhr })
}
if (!globalThis.localStorage) {
  inject(globalThis, {
    Storage,
    localStorage: createStorage(false),
    sessionStorage: createStorage(true)
  })
}
if (!globalThis.URL) {
  inject(globalThis, { URL, URLSearchParams })
}
if (!globalThis.URLPattern) {
  inject(globalThis, { URLPattern })
}
if (!globalThis.WebSocket) {
  inject(globalThis, { WebSocket })
}
if (!globalThis.EventSource) {
  inject(globalThis, { EventSource })
}
if (!globalThis.Worker) {
  inject(globalThis, { Worker })
  // What the runtime makes a worker's global object with:
  Object.assign(natives, { setupWorker })
}
// The Web Locks of all of the app's scripts:
if (globalThis.navigator && !navigator.locks) {
  inject(globalThis, { Lock, LockManager })
  inject(navigator, { locks: new LockManager(internal) }, { writable: false })
}
if (!globalThis.SharedWorker) {
  inject(globalThis, { SharedWorker })
}
if (!globalThis.MessageChannel) {
  inject(globalThis, { MessageChannel, MessagePort })
  // What the runtime makes the ports it receives with:
  Object.assign(natives, { makePort })
}
if (!globalThis.BroadcastChannel) {
  inject(globalThis, { BroadcastChannel })
}
// A DOM outside a browser, after Paper.js, which would take one for a browser's:
if (natives.dom && !globalThis.document) {
  inject(globalThis, dom, { configurable: true })
}
// The file system on desktop, by path; the web has the browser's:
if (natives.fs) {
  const { getHandlePath, getDirectoryHandle, ...classes } = fileSystem
  inject(globalThis, { LocalFile, StorageManager, ...classes })
  // With each script's own folder of files:
  inject(navigator, { storage: new StorageManager() }, { writable: false })
}
if (!globalThis.OffscreenCanvas) {
  inject(globalThis, { ...canvas })
}
// Fonts for the canvases, as a worker has them, `fonts`:
if (!globalThis.FontFace) {
  inject(globalThis, {
    FontFace,
    FontFaceSet,
    fonts: new FontFaceSet(internal)
  })
}
if (!globalThis.DOMMatrix) {
  const { getGeometryValues, ...classes } = geometry
  inject(globalThis, { ...classes, WebKitCSSMatrix: geometry.DOMMatrix })
  // What structured serialization reads of them:
  Object.assign(natives, { getGeometryValues })
}
setupDialog((globalThis.Dialog ??= {}))
inject(globalThis, { Palette })
// What the runtime reports of the palettes, and tells them:
Object.assign(natives, { takePalettes, hasPalettes, handlePaletteEvent })
// What it watches the scripts' effects with, and draws them with:
Object.assign(natives, { watchEffects, applyEffect })
