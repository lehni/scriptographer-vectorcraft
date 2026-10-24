(() => {
  var __defProp = Object.defineProperty;
  var __name = (target, value) => __defProp(target, "name", { value, configurable: true });
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };

  // src/natives.js
  var natives = globalThis.__scriptographer;

  // src/define.js
  function inject(target, source, attributes) {
    for (const key of Reflect.ownKeys(source)) {
      Object.defineProperty(target, key, {
        ...Object.getOwnPropertyDescriptor(source, key),
        enumerable: false,
        ...attributes
      });
    }
    return target;
  }
  __name(inject, "inject");
  function defineConstants(Class, constants2) {
    for (const target of [Class, Class.prototype]) {
      inject(target, constants2, {
        enumerable: true,
        writable: false,
        configurable: false
      });
    }
  }
  __name(defineConstants, "defineConstants");
  function setToStringTag(...classes) {
    for (const Class of classes) {
      inject(
        Class.prototype,
        { [Symbol.toStringTag]: Class.name },
        { writable: false }
      );
    }
  }
  __name(setToStringTag, "setToStringTag");
  var internal = /* @__PURE__ */ Symbol("internal");
  function checkInternal(key, name, how) {
    if (key !== internal) {
      throw new TypeError(`Invalid ${name}: ${how}.`);
    }
  }
  __name(checkInternal, "checkInternal");
  function checkArguments(args, count, name) {
    if (args.length < count) {
      throw new TypeError(`Invalid ${name}(): an argument is missing.`);
    }
  }
  __name(checkArguments, "checkArguments");

  // src/abort.js
  var abort_exports = {};
  __export(abort_exports, {
    AbortController: () => AbortController2,
    AbortSignal: () => AbortSignal
  });

  // src/events.js
  var events_exports = {};
  __export(events_exports, {
    CloseEvent: () => CloseEvent,
    CustomEvent: () => CustomEvent,
    ErrorEvent: () => ErrorEvent,
    Event: () => Event,
    EventTarget: () => EventTarget,
    MessageEvent: () => MessageEvent,
    ProgressEvent: () => ProgressEvent,
    PromiseRejectionEvent: () => PromiseRejectionEvent,
    defineEventHandlers: () => defineEventHandlers,
    fire: () => fire
  });

  // src/global-scope.js
  var global_scope_exports = {};
  __export(global_scope_exports, {
    atob: () => atob,
    btoa: () => btoa,
    isSecureContext: () => isSecureContext,
    performance: () => performance,
    queueMicrotask: () => queueMicrotask2,
    reportError: () => reportError
  });

  // src/format-error.js
  function formatError(err) {
    const text = String(err);
    const stack = err?.stack;
    return typeof stack === "string" && stack.startsWith(text) ? stack : text;
  }
  __name(formatError, "formatError");

  // src/global-scope.js
  var isSecureContext = true;
  var performance = {
    timeOrigin: Date.now(),
    // The milliseconds since the runtime started.
    now() {
      return natives.now();
    }
  };
  function queueMicrotask2(callback) {
    if (typeof callback !== "function") {
      throw new TypeError(`Invalid callback: '${callback}', not a function.`);
    }
    Promise.resolve().then(() => {
      try {
        callback();
      } catch (err) {
        reportError(err);
      }
    });
  }
  __name(queueMicrotask2, "queueMicrotask");
  function reportError(err) {
    console.error(`Uncaught ${formatError(err)}`);
  }
  __name(reportError, "reportError");
  var alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  function atob(data) {
    let text = String(data).replace(/[\t\n\f\r ]/g, "");
    if (text.length % 4 === 0) text = text.replace(/==?$/, "");
    if (text.length % 4 === 1 || /[^A-Za-z0-9+/]/.test(text)) {
      throw new DOMException(
        "Invalid base64: the string is not correctly encoded.",
        "InvalidCharacterError"
      );
    }
    let bits = 0;
    let count = 0;
    let result = "";
    for (const char of text) {
      bits = bits << 6 | alphabet.indexOf(char);
      count += 6;
      if (count >= 8) {
        count -= 8;
        result += String.fromCharCode(bits >> count & 255);
      }
    }
    return result;
  }
  __name(atob, "atob");
  function btoa(data) {
    const text = String(data);
    if (/[^\0-\xff]/.test(text)) {
      throw new DOMException(
        "Invalid character: btoa() takes characters up to 255 only.",
        "InvalidCharacterError"
      );
    }
    let result = "";
    for (let i2 = 0; i2 < text.length; i2 += 3) {
      const [a3, b3, c2] = [0, 1, 2].map((j3) => text.charCodeAt(i2 + j3));
      const bits = a3 << 16 | (b3 || 0) << 8 | (c2 || 0);
      result += alphabet[bits >> 18 & 63] + alphabet[bits >> 12 & 63] + (i2 + 1 < text.length ? alphabet[bits >> 6 & 63] : "=") + (i2 + 2 < text.length ? alphabet[bits & 63] : "=");
    }
    return result;
  }
  __name(btoa, "btoa");

  // src/events.js
  var phases = { NONE: 0, CAPTURING_PHASE: 1, AT_TARGET: 2, BUBBLING_PHASE: 3 };
  var listenersByTarget = /* @__PURE__ */ new WeakMap();
  var states = /* @__PURE__ */ new WeakMap();
  var handlersByTarget = /* @__PURE__ */ new WeakMap();
  var EventTarget = class {
    static {
      __name(this, "EventTarget");
    }
    addEventListener(type, callback, options) {
      if (callback && typeof callback === "object" || typeof callback === "function") {
        const { capture, once, passive, signal } = getOptions(options);
        if (!signal?.aborted) {
          type = String(type);
          let listeners = listenersByTarget.get(this);
          if (!listeners) {
            listeners = [];
            listenersByTarget.set(this, listeners);
          }
          if (!find(listeners, type, callback, capture)) {
            const listener = {
              type,
              callback,
              capture,
              once,
              passive,
              removed: false
            };
            listeners.push(listener);
            signal?.addEventListener("abort", () => remove(this, listener));
          }
        }
      }
    }
    removeEventListener(type, callback, options) {
      const { capture } = getOptions(options);
      const listener = find(
        listenersByTarget.get(this),
        String(type),
        callback,
        capture
      );
      if (listener) remove(this, listener);
    }
    dispatchEvent(event) {
      const state = states.get(event);
      if (!state) {
        throw new TypeError(`Invalid event: '${event}', not an Event.`);
      }
      if (state.dispatching) {
        throw new DOMException(
          "Unable to dispatch an event that is being dispatched.",
          "InvalidStateError"
        );
      }
      Object.assign(state, {
        dispatching: true,
        target: this,
        currentTarget: this,
        eventPhase: phases.AT_TARGET
      });
      for (const listener of [...listenersByTarget.get(this) ?? []]) {
        if (!listener.removed && listener.type === state.type) {
          if (listener.once) remove(this, listener);
          const { callback } = listener;
          state.passive = listener.passive;
          try {
            if (typeof callback === "function") {
              callback.call(this, event);
            } else if (typeof callback.handleEvent === "function") {
              callback.handleEvent(event);
            } else {
              throw new TypeError("Invalid listener: it has no handleEvent().");
            }
          } catch (err) {
            reportError(err);
          }
          state.passive = false;
          if (state.stopImmediately) break;
        }
      }
      Object.assign(state, {
        dispatching: false,
        stop: false,
        stopImmediately: false,
        currentTarget: null,
        eventPhase: phases.NONE
      });
      return !state.defaultPrevented;
    }
  };
  var Event = class {
    static {
      __name(this, "Event");
    }
    constructor(type, init) {
      if (arguments.length === 0) {
        throw new TypeError("Invalid event: its type is missing.");
      }
      const { bubbles, cancelable, composed } = init ?? {};
      states.set(this, {
        type: String(type),
        bubbles: !!bubbles,
        cancelable: !!cancelable,
        composed: !!composed,
        defaultPrevented: false,
        eventPhase: phases.NONE,
        target: null,
        currentTarget: null,
        timeStamp: globalThis.performance?.now() ?? 0,
        isTrusted: false
      });
    }
    get srcElement() {
      return getState(this).target;
    }
    get returnValue() {
      return !getState(this).defaultPrevented;
    }
    set returnValue(value) {
      if (!value) this.preventDefault();
    }
    get cancelBubble() {
      return !!getState(this).stop;
    }
    set cancelBubble(value) {
      if (value) getState(this).stop = true;
    }
    // A passive listener can't cancel an event:
    preventDefault() {
      const state = getState(this);
      if (state.cancelable && !state.passive) state.defaultPrevented = true;
    }
    stopPropagation() {
      getState(this).stop = true;
    }
    stopImmediatePropagation() {
      Object.assign(getState(this), { stop: true, stopImmediately: true });
    }
    // The target while the event is dispatched, as there's no tree around it.
    composedPath() {
      const { currentTarget } = getState(this);
      return currentTarget ? [currentTarget] : [];
    }
    // The legacy way, before the event is dispatched.
    initEvent(type, bubbles = false, cancelable = false) {
      const state = getState(this);
      if (!state.dispatching) {
        Object.assign(state, {
          type: String(type),
          bubbles: !!bubbles,
          cancelable: !!cancelable,
          stop: false,
          stopImmediately: false,
          defaultPrevented: false
        });
      }
    }
  };
  var CustomEvent = class extends Event {
    static {
      __name(this, "CustomEvent");
    }
    constructor(type, init) {
      super(...arguments);
      setMembers(this, init, { detail: null });
    }
    initCustomEvent(type, bubbles, cancelable, detail = null) {
      this.initEvent(type, bubbles, cancelable);
      const state = getState(this);
      if (!state.dispatching) state.detail = detail;
    }
  };
  var MessageEvent = class extends Event {
    static {
      __name(this, "MessageEvent");
    }
    constructor(type, init) {
      super(...arguments);
      setMembers(this, init, {
        data: null,
        origin: "",
        lastEventId: "",
        source: null,
        ports: []
      });
    }
  };
  var CloseEvent = class extends Event {
    static {
      __name(this, "CloseEvent");
    }
    constructor(type, init) {
      super(...arguments);
      setMembers(this, init, { wasClean: false, code: 0, reason: "" });
    }
  };
  var ProgressEvent = class extends Event {
    static {
      __name(this, "ProgressEvent");
    }
    constructor(type, init) {
      super(...arguments);
      setMembers(this, init, { lengthComputable: false, loaded: 0, total: 0 });
    }
  };
  var ErrorEvent = class extends Event {
    static {
      __name(this, "ErrorEvent");
    }
    constructor(type, init) {
      super(...arguments);
      setMembers(this, init, {
        message: "",
        filename: "",
        lineno: 0,
        colno: 0,
        error: null
      });
    }
  };
  var PromiseRejectionEvent = class extends Event {
    static {
      __name(this, "PromiseRejectionEvent");
    }
    constructor(type, init) {
      super(...arguments);
      if (!init || !("promise" in init)) {
        throw new TypeError("Invalid event: its promise is missing.");
      }
      setMembers(this, init, { promise: null, reason: void 0 });
    }
  };
  var fields = {
    [Event.name]: [
      "type",
      "bubbles",
      "cancelable",
      "composed",
      "defaultPrevented",
      "eventPhase",
      "target",
      "currentTarget",
      "timeStamp",
      "isTrusted"
    ],
    [CustomEvent.name]: ["detail"],
    [MessageEvent.name]: ["data", "origin", "lastEventId", "source", "ports"],
    [CloseEvent.name]: ["wasClean", "code", "reason"],
    [ProgressEvent.name]: ["lengthComputable", "loaded", "total"],
    [ErrorEvent.name]: ["message", "filename", "lineno", "colno", "error"],
    [PromiseRejectionEvent.name]: ["promise", "reason"]
  };
  for (const Class of [
    Event,
    CustomEvent,
    MessageEvent,
    CloseEvent,
    ProgressEvent,
    ErrorEvent,
    PromiseRejectionEvent
  ]) {
    for (const name of fields[Class.name]) {
      inject(
        Class.prototype,
        {
          get [name]() {
            return getState(this)[name];
          }
        },
        { enumerable: true }
      );
    }
  }
  defineConstants(Event, phases);
  setToStringTag(
    EventTarget,
    Event,
    CustomEvent,
    MessageEvent,
    CloseEvent,
    ProgressEvent,
    ErrorEvent,
    PromiseRejectionEvent
  );
  function defineEventHandlers(target, ...types2) {
    for (const type of types2) {
      inject(
        target,
        {
          get [`on${type}`]() {
            return handlersByTarget.get(this)?.[type] ?? null;
          },
          set [`on${type}`](handler2) {
            let handlers = handlersByTarget.get(this);
            if (!handlers) {
              handlers = {};
              handlersByTarget.set(this, handlers);
            }
            handlers[type] = typeof handler2 === "function" ? handler2 : null;
          }
        },
        { enumerable: true }
      );
    }
  }
  __name(defineEventHandlers, "defineEventHandlers");
  function fire(target, event) {
    const handler2 = handlersByTarget.get(target)?.[event.type];
    if (handler2) {
      try {
        handler2.call(target, event);
      } catch (err) {
        reportError(err);
      }
    }
    return target.dispatchEvent(event);
  }
  __name(fire, "fire");
  function getState(event) {
    const state = states.get(event);
    if (!state) {
      throw new TypeError(`Invalid event: '${event}', not an Event.`);
    }
    return state;
  }
  __name(getState, "getState");
  function setMembers(event, init, defaults2) {
    const state = getState(event);
    for (const [name, value] of Object.entries(defaults2)) {
      const given = init?.[name];
      state[name] = given === void 0 ? Array.isArray(value) ? [] : value : typeof value === "string" ? String(given) : typeof value === "number" ? Number(given) : typeof value === "boolean" ? !!given : given;
    }
  }
  __name(setMembers, "setMembers");
  function getOptions(options) {
    if (options && typeof options === "object") {
      const { capture, once, passive, signal } = options;
      return { capture: !!capture, once: !!once, passive: !!passive, signal };
    } else {
      return { capture: !!options, once: false, passive: false, signal: null };
    }
  }
  __name(getOptions, "getOptions");
  function find(listeners, type, callback, capture) {
    return listeners?.find(
      (listener) => listener.type === type && listener.capture === capture && Object.is(listener.callback, callback)
    );
  }
  __name(find, "find");
  function remove(target, listener) {
    listener.removed = true;
    const listeners = listenersByTarget.get(target);
    const index = listeners?.indexOf(listener) ?? -1;
    if (index >= 0) listeners.splice(index, 1);
  }
  __name(remove, "remove");

  // src/abort.js
  var abort;
  var AbortSignal = class _AbortSignal extends EventTarget {
    static {
      __name(this, "AbortSignal");
    }
    #aborted = false;
    #reason;
    constructor(key) {
      checkInternal(
        key,
        "AbortSignal",
        "AbortController, AbortSignal.abort() and AbortSignal.timeout() make them"
      );
      super();
    }
    static {
      abort = /* @__PURE__ */ __name((signal, reason) => {
        if (!signal.#aborted) {
          signal.#aborted = true;
          signal.#reason = reason === void 0 ? new DOMException(
            "signal is aborted without reason",
            "AbortError"
          ) : reason;
          fire(signal, new Event("abort"));
        }
      }, "abort");
    }
    get aborted() {
      return this.#aborted;
    }
    get reason() {
      return this.#reason;
    }
    throwIfAborted() {
      if (this.#aborted) throw this.#reason;
    }
    static abort(reason) {
      const signal = new _AbortSignal(internal);
      abort(signal, reason);
      return signal;
    }
    static timeout(milliseconds) {
      const signal = new _AbortSignal(internal);
      setTimeout(
        () => abort(signal, new DOMException("signal timed out", "TimeoutError")),
        milliseconds
      );
      return signal;
    }
    // A signal that aborts when the first of `signals` does.
    static any(signals) {
      const signal = new _AbortSignal(internal);
      for (const from of signals) {
        if (from.aborted) {
          abort(signal, from.reason);
          break;
        }
        from.addEventListener("abort", () => abort(signal, from.reason), {
          once: true
        });
      }
      return signal;
    }
  };
  var AbortController2 = class {
    static {
      __name(this, "AbortController");
    }
    #signal = new AbortSignal(internal);
    get signal() {
      return this.#signal;
    }
    abort(reason) {
      abort(this.#signal, reason);
    }
  };
  defineEventHandlers(AbortSignal.prototype, "abort");
  setToStringTag(AbortSignal, AbortController2);

  // src/blob.js
  var blob_exports = {};
  __export(blob_exports, {
    Blob: () => Blob,
    File: () => File,
    getBufferBytes: () => getBufferBytes,
    getBytes: () => getBytes,
    readBytes: () => readBytes
  });

  // src/streams.js
  var streams_exports = {};
  __export(streams_exports, {
    ByteLengthQueuingStrategy: () => ByteLengthQueuingStrategy,
    CountQueuingStrategy: () => CountQueuingStrategy,
    ReadableByteStreamController: () => ReadableByteStreamController,
    ReadableStream: () => ReadableStream,
    ReadableStreamBYOBReader: () => ReadableStreamBYOBReader,
    ReadableStreamBYOBRequest: () => ReadableStreamBYOBRequest,
    ReadableStreamDefaultController: () => ReadableStreamDefaultController,
    ReadableStreamDefaultReader: () => ReadableStreamDefaultReader,
    TransformStream: () => TransformStream,
    TransformStreamDefaultController: () => TransformStreamDefaultController,
    WritableStream: () => WritableStream,
    WritableStreamDefaultController: () => WritableStreamDefaultController,
    WritableStreamDefaultWriter: () => WritableStreamDefaultWriter
  });

  // ../vendor/web-streams-polyfill.mjs
  /**
   * @license
   * web-streams-polyfill v4.3.0
   * Copyright 2026 Mattias Buelens, Diwank Singh Tomer and other contributors.
   * This code is released under the MIT license.
   * SPDX-License-Identifier: MIT
   */
  function e() {
  }
  __name(e, "e");
  function t(e2) {
    return "object" == typeof e2 && null !== e2 || "function" == typeof e2;
  }
  __name(t, "t");
  var r = e;
  function o(e2, t2) {
    try {
      Object.defineProperty(e2, "name", { value: t2, configurable: true });
    } catch (e3) {
    }
  }
  __name(o, "o");
  var n = Promise;
  var i = Promise.resolve.bind(n);
  var a = Promise.prototype.then;
  var s = Promise.reject.bind(n);
  var l = i;
  function u(e2) {
    return new n(e2);
  }
  __name(u, "u");
  function c(e2) {
    return u((t2) => t2(e2));
  }
  __name(c, "c");
  function d(e2) {
    return s(e2);
  }
  __name(d, "d");
  function f(e2, t2, r2) {
    return a.call(e2, t2, r2);
  }
  __name(f, "f");
  function h(e2, t2, o2) {
    f(f(e2, t2, o2), void 0, r);
  }
  __name(h, "h");
  function b(e2, t2) {
    h(e2, t2);
  }
  __name(b, "b");
  function _(e2, t2) {
    h(e2, void 0, t2);
  }
  __name(_, "_");
  function m(e2, t2, r2) {
    return f(e2, t2, r2);
  }
  __name(m, "m");
  function p(e2) {
    f(e2, void 0, r);
  }
  __name(p, "p");
  var y = /* @__PURE__ */ __name((e2) => {
    if ("function" == typeof queueMicrotask) y = queueMicrotask;
    else {
      const e3 = c(void 0);
      y = /* @__PURE__ */ __name((t2) => f(e3, t2), "y");
    }
    return y(e2);
  }, "y");
  function S(e2, t2, r2) {
    if ("function" != typeof e2) throw new TypeError("Argument is not a function");
    return Function.prototype.apply.call(e2, t2, r2);
  }
  __name(S, "S");
  function g(e2, t2, r2) {
    try {
      return c(S(e2, t2, r2));
    } catch (e3) {
      return d(e3);
    }
  }
  __name(g, "g");
  var v = class {
    static {
      __name(this, "v");
    }
    constructor() {
      this._cursor = 0, this._size = 0, this._front = { _elements: [], _next: void 0 }, this._back = this._front, this._cursor = 0, this._size = 0;
    }
    get length() {
      return this._size;
    }
    push(e2) {
      const t2 = this._back;
      let r2 = t2;
      16383 === t2._elements.length && (r2 = { _elements: [], _next: void 0 }), t2._elements.push(e2), r2 !== t2 && (this._back = r2, t2._next = r2), ++this._size;
    }
    shift() {
      const e2 = this._front;
      let t2 = e2;
      const r2 = this._cursor;
      let o2 = r2 + 1;
      const n2 = e2._elements, i2 = n2[r2];
      return 16384 === o2 && (t2 = e2._next, o2 = 0), --this._size, this._cursor = o2, e2 !== t2 && (this._front = t2), n2[r2] = void 0, i2;
    }
    forEach(e2) {
      let t2 = this._cursor, r2 = this._front, o2 = r2._elements;
      for (; !(t2 === o2.length && void 0 === r2._next || t2 === o2.length && (r2 = r2._next, o2 = r2._elements, t2 = 0, 0 === o2.length)); ) e2(o2[t2]), ++t2;
    }
    peek() {
      const e2 = this._front, t2 = this._cursor;
      return e2._elements[t2];
    }
  };
  var w = /* @__PURE__ */ Symbol("[[AbortSteps]]");
  var R = /* @__PURE__ */ Symbol("[[ErrorSteps]]");
  var T = /* @__PURE__ */ Symbol("[[CancelSteps]]");
  var P = /* @__PURE__ */ Symbol("[[PullSteps]]");
  var C = /* @__PURE__ */ Symbol("[[CanPullSyncSteps]]");
  var q = /* @__PURE__ */ Symbol("[[ReleaseSteps]]");
  function E(e2, t2) {
    e2._ownerReadableStream = t2, t2._reader = e2, "readable" === t2._state ? j(e2) : "closed" === t2._state ? (function(e3) {
      j(e3), z(e3);
    })(e2) : k(e2, t2._storedError);
  }
  __name(E, "E");
  function W(e2, t2) {
    return Mr(e2._ownerReadableStream, t2);
  }
  __name(W, "W");
  function O(e2) {
    const t2 = e2._ownerReadableStream;
    "readable" === t2._state ? A(e2, new TypeError("Reader was released and can no longer be used to monitor the stream's closedness")) : (function(e3, t3) {
      k(e3, t3);
    })(e2, new TypeError("Reader was released and can no longer be used to monitor the stream's closedness")), t2._readableStreamController[q](), t2._reader = void 0, e2._ownerReadableStream = void 0;
  }
  __name(O, "O");
  function B(e2) {
    return new TypeError("Cannot " + e2 + " a stream using a released reader");
  }
  __name(B, "B");
  function j(e2) {
    e2._closedPromise = u((t2, r2) => {
      e2._closedPromise_resolve = t2, e2._closedPromise_reject = r2;
    });
  }
  __name(j, "j");
  function k(e2, t2) {
    j(e2), A(e2, t2);
  }
  __name(k, "k");
  function A(e2, t2) {
    void 0 !== e2._closedPromise_reject && (p(e2._closedPromise), e2._closedPromise_reject(t2), e2._closedPromise_resolve = void 0, e2._closedPromise_reject = void 0);
  }
  __name(A, "A");
  function z(e2) {
    void 0 !== e2._closedPromise_resolve && (e2._closedPromise_resolve(void 0), e2._closedPromise_resolve = void 0, e2._closedPromise_reject = void 0);
  }
  __name(z, "z");
  var D = Number.isFinite || function(e2) {
    return "number" == typeof e2 && isFinite(e2);
  };
  var F = Math.trunc || function(e2) {
    return e2 < 0 ? Math.ceil(e2) : Math.floor(e2);
  };
  function L(e2, t2) {
    if (void 0 !== e2 && ("object" != typeof (r2 = e2) && "function" != typeof r2)) throw new TypeError(`${t2} is not an object.`);
    var r2;
  }
  __name(L, "L");
  function I(e2, t2) {
    if ("function" != typeof e2) throw new TypeError(`${t2} is not a function.`);
  }
  __name(I, "I");
  function $(e2, t2) {
    if (!/* @__PURE__ */ (function(e3) {
      return "object" == typeof e3 && null !== e3 || "function" == typeof e3;
    })(e2)) throw new TypeError(`${t2} is not an object.`);
  }
  __name($, "$");
  function M(e2, t2, r2) {
    if (void 0 === e2) throw new TypeError(`Parameter ${t2} is required in '${r2}'.`);
  }
  __name(M, "M");
  function Y(e2, t2, r2) {
    if (void 0 === e2) throw new TypeError(`${t2} is required in '${r2}'.`);
  }
  __name(Y, "Y");
  function x(e2) {
    return Number(e2);
  }
  __name(x, "x");
  function Q(e2) {
    return 0 === e2 ? 0 : e2;
  }
  __name(Q, "Q");
  function N(e2, t2) {
    const r2 = Number.MAX_SAFE_INTEGER;
    let o2 = Number(e2);
    if (o2 = Q(o2), !D(o2)) throw new TypeError(`${t2} is not a finite number`);
    if (o2 = (function(e3) {
      return Q(F(e3));
    })(o2), o2 < 0 || o2 > r2) throw new TypeError(`${t2} is outside the accepted range of 0 to ${r2}, inclusive`);
    return D(o2) && 0 !== o2 ? o2 : 0;
  }
  __name(N, "N");
  function H(e2, t2) {
    if (!Ir(e2)) throw new TypeError(`${t2} is not a ReadableStream.`);
  }
  __name(H, "H");
  function V(e2) {
    return new ReadableStreamDefaultReader(e2);
  }
  __name(V, "V");
  function U(e2, t2) {
    e2._reader._readRequests.push(t2);
  }
  __name(U, "U");
  function G(e2, t2, r2) {
    const o2 = e2._reader._readRequests.shift();
    r2 ? o2._closeSteps() : o2._chunkSteps(t2);
  }
  __name(G, "G");
  function X(e2) {
    return e2._reader._readRequests.length;
  }
  __name(X, "X");
  function J(e2) {
    const t2 = e2._reader;
    return void 0 !== t2 && !!ee(t2);
  }
  __name(J, "J");
  var ReadableStreamDefaultReader = class {
    static {
      __name(this, "ReadableStreamDefaultReader");
    }
    constructor(e2) {
      if (M(e2, 1, "ReadableStreamDefaultReader"), H(e2, "First parameter"), $r(e2)) throw new TypeError("This stream has already been locked for exclusive reading by another reader");
      E(this, e2), this._readRequests = new v();
    }
    get closed() {
      return ee(this) ? this._closedPromise : d(ne("closed"));
    }
    cancel(e2 = void 0) {
      return ee(this) ? void 0 === this._ownerReadableStream ? d(B("cancel")) : W(this, e2) : d(ne("cancel"));
    }
    read() {
      if (!ee(this)) return d(ne("read"));
      if (void 0 === this._ownerReadableStream) return d(B("read from"));
      const e2 = re(this) ? new Z() : new K();
      return te(this, e2), e2._promise;
    }
    releaseLock() {
      if (!ee(this)) throw ne("releaseLock");
      void 0 !== this._ownerReadableStream && (function(e2) {
        O(e2);
        const t2 = new TypeError("Reader was released");
        oe(e2, t2);
      })(this);
    }
  };
  Object.defineProperties(ReadableStreamDefaultReader.prototype, { cancel: { enumerable: true }, read: { enumerable: true }, releaseLock: { enumerable: true }, closed: { enumerable: true } }), o(ReadableStreamDefaultReader.prototype.cancel, "cancel"), o(ReadableStreamDefaultReader.prototype.read, "read"), o(ReadableStreamDefaultReader.prototype.releaseLock, "releaseLock"), "symbol" == typeof Symbol.toStringTag && Object.defineProperty(ReadableStreamDefaultReader.prototype, Symbol.toStringTag, { value: "ReadableStreamDefaultReader", configurable: true });
  var K = class {
    static {
      __name(this, "K");
    }
    constructor() {
      this._promise = u((e2, t2) => {
        this._resolvePromise = e2, this._rejectPromise = t2;
      });
    }
    _chunkSteps(e2) {
      this._resolvePromise({ value: e2, done: false });
    }
    _closeSteps() {
      this._resolvePromise({ value: void 0, done: true });
    }
    _errorSteps(e2) {
      this._rejectPromise(e2);
    }
  };
  var Z = class {
    static {
      __name(this, "Z");
    }
    constructor() {
      this._promise = void 0;
    }
    _chunkSteps(e2) {
      this._promise = l({ value: e2, done: false });
    }
    _closeSteps() {
      this._promise = l({ value: void 0, done: true });
    }
    _errorSteps(e2) {
      this._promise = d(e2);
    }
  };
  function ee(e2) {
    return !!t(e2) && (!!Object.prototype.hasOwnProperty.call(e2, "_readRequests") && e2 instanceof ReadableStreamDefaultReader);
  }
  __name(ee, "ee");
  function te(e2, t2) {
    const r2 = e2._ownerReadableStream;
    r2._disturbed = true, "closed" === r2._state ? t2._closeSteps() : "errored" === r2._state ? t2._errorSteps(r2._storedError) : r2._readableStreamController[P](t2);
  }
  __name(te, "te");
  function re(e2) {
    const t2 = e2._ownerReadableStream;
    return "closed" === t2._state || ("errored" === t2._state || t2._readableStreamController[C]());
  }
  __name(re, "re");
  function oe(e2, t2) {
    const r2 = e2._readRequests;
    e2._readRequests = new v(), r2.forEach((e3) => {
      e3._errorSteps(t2);
    });
  }
  __name(oe, "oe");
  function ne(e2) {
    return new TypeError(`ReadableStreamDefaultReader.prototype.${e2} can only be used on a ReadableStreamDefaultReader`);
  }
  __name(ne, "ne");
  var ie;
  var ae;
  var se;
  function le(e2) {
    return e2.slice();
  }
  __name(le, "le");
  function ue(e2, t2, r2, o2, n2) {
    new Uint8Array(e2).set(new Uint8Array(r2, o2, n2), t2);
  }
  __name(ue, "ue");
  var ce = /* @__PURE__ */ __name((e2) => (ce = "function" == typeof e2.transfer ? (e3) => e3.transfer() : "function" == typeof structuredClone ? (e3) => structuredClone(e3, { transfer: [e3] }) : (e3) => e3, ce(e2)), "ce");
  var de = /* @__PURE__ */ __name((e2) => (de = "boolean" == typeof e2.detached ? (e3) => e3.detached : (e3) => 0 === e3.byteLength, de(e2)), "de");
  function fe(e2, t2, r2) {
    if (e2.slice) return e2.slice(t2, r2);
    const o2 = r2 - t2, n2 = new ArrayBuffer(o2);
    return ue(n2, 0, e2, t2, o2), n2;
  }
  __name(fe, "fe");
  function he(e2, t2) {
    const r2 = e2[t2];
    if (null != r2) {
      if ("function" != typeof r2) throw new TypeError(`${String(t2)} is not a function`);
      return r2;
    }
  }
  __name(he, "he");
  function be(e2) {
    try {
      const t2 = e2.done, r2 = e2.value;
      return f(l(r2), (e3) => ({ done: t2, value: e3 }));
    } catch (e3) {
      return d(e3);
    }
  }
  __name(be, "be");
  var _e = null !== (se = null !== (ie = Symbol.asyncIterator) && void 0 !== ie ? ie : null === (ae = Symbol.for) || void 0 === ae ? void 0 : ae.call(Symbol, "Symbol.asyncIterator")) && void 0 !== se ? se : "@@asyncIterator";
  function me(e2, r2 = "sync", o2) {
    if (void 0 === o2) if ("async" === r2) {
      if (void 0 === (o2 = he(e2, _e))) {
        return (function(e3) {
          const r3 = { next() {
            let t2;
            try {
              t2 = pe(e3);
            } catch (e4) {
              return d(e4);
            }
            return be(t2);
          }, return(r4) {
            let o3;
            try {
              const t2 = he(e3.iterator, "return");
              if (void 0 === t2) return c({ done: true, value: r4 });
              o3 = S(t2, e3.iterator, [r4]);
            } catch (e4) {
              return d(e4);
            }
            return t(o3) ? be(o3) : d(new TypeError("The iterator.return() method must return an object"));
          } };
          return { iterator: r3, nextMethod: r3.next, done: false };
        })(me(e2, "sync", he(e2, Symbol.iterator)));
      }
    } else o2 = he(e2, Symbol.iterator);
    if (void 0 === o2) throw new TypeError("The object is not iterable");
    const n2 = S(o2, e2, []);
    if (!t(n2)) throw new TypeError("The iterator method must return an object");
    return { iterator: n2, nextMethod: n2.next, done: false };
  }
  __name(me, "me");
  function pe(e2) {
    const r2 = S(e2.nextMethod, e2.iterator, []);
    if (!t(r2)) throw new TypeError("The iterator.next() method must return an object");
    return r2;
  }
  __name(pe, "pe");
  var ye = class {
    static {
      __name(this, "ye");
    }
    constructor(e2, t2) {
      this._ongoingPromise = void 0, this._isFinished = false, this._reader = e2, this._preventCancel = t2;
    }
    next() {
      const e2 = /* @__PURE__ */ __name(() => this._nextSteps(), "e");
      return this._ongoingPromise = this._ongoingPromise ? m(this._ongoingPromise, e2, e2) : e2(), this._ongoingPromise;
    }
    return(e2) {
      const t2 = /* @__PURE__ */ __name(() => this._returnSteps(e2), "t");
      return this._ongoingPromise = this._ongoingPromise ? m(this._ongoingPromise, t2, t2) : t2(), this._ongoingPromise;
    }
    _nextSteps() {
      if (this._isFinished) return Promise.resolve({ value: void 0, done: true });
      const e2 = this._reader, t2 = new Se(this);
      return te(e2, t2), t2._promise;
    }
    _returnSteps(e2) {
      if (this._isFinished) return Promise.resolve({ value: e2, done: true });
      this._isFinished = true;
      const t2 = this._reader;
      if (!this._preventCancel) {
        const r2 = W(t2, e2);
        return O(t2), m(r2, () => ({ value: e2, done: true }));
      }
      return O(t2), c({ value: e2, done: true });
    }
  };
  var Se = class {
    static {
      __name(this, "Se");
    }
    constructor(e2) {
      this._iterator = e2, this._promise = u((e3, t2) => {
        this._resolvePromise = e3, this._rejectPromise = t2;
      });
    }
    _chunkSteps(e2) {
      this._iterator._ongoingPromise = void 0, y(() => this._resolvePromise({ value: e2, done: false }));
    }
    _closeSteps() {
      const e2 = this._iterator;
      e2._ongoingPromise = void 0, e2._isFinished = true, O(e2._reader), this._resolvePromise({ value: void 0, done: true });
    }
    _errorSteps(e2) {
      const t2 = this._iterator;
      t2._ongoingPromise = void 0, t2._isFinished = true, O(t2._reader), this._rejectPromise(e2);
    }
  };
  var ge = { next() {
    return ve(this) ? this._asyncIteratorImpl.next() : d(we("next"));
  }, return(e2) {
    return ve(this) ? this._asyncIteratorImpl.return(e2) : d(we("return"));
  }, [_e]() {
    return this;
  } };
  function ve(e2) {
    if (!t(e2)) return false;
    if (!Object.prototype.hasOwnProperty.call(e2, "_asyncIteratorImpl")) return false;
    try {
      return e2._asyncIteratorImpl instanceof ye;
    } catch (e3) {
      return false;
    }
  }
  __name(ve, "ve");
  function we(e2) {
    return new TypeError(`ReadableStreamAsyncIterator.${e2} can only be used on a ReadableSteamAsyncIterator`);
  }
  __name(we, "we");
  Object.defineProperty(ge, _e, { enumerable: false });
  var Re = Number.isNaN || function(e2) {
    return e2 != e2;
  };
  function Te(e2) {
    const t2 = fe(e2.buffer, e2.byteOffset, e2.byteOffset + e2.byteLength);
    return new Uint8Array(t2);
  }
  __name(Te, "Te");
  function Pe(e2) {
    const t2 = e2._queue.shift();
    return e2._queueTotalSize -= t2.size, e2._queueTotalSize < 0 && (e2._queueTotalSize = 0), t2.value;
  }
  __name(Pe, "Pe");
  function Ce(e2, t2, r2) {
    if ("number" != typeof (o2 = r2) || Re(o2) || o2 < 0 || r2 === 1 / 0) throw new RangeError("Size must be a finite, non-NaN, non-negative number.");
    var o2;
    e2._queue.push({ value: t2, size: r2 }), e2._queueTotalSize += r2;
  }
  __name(Ce, "Ce");
  function qe(e2) {
    e2._queue = new v(), e2._queueTotalSize = 0;
  }
  __name(qe, "qe");
  function Ee(e2) {
    return e2 === DataView;
  }
  __name(Ee, "Ee");
  function We(e2) {
    return Ee(e2) ? 1 : e2.BYTES_PER_ELEMENT;
  }
  __name(We, "We");
  var ReadableStreamBYOBRequest = class {
    static {
      __name(this, "ReadableStreamBYOBRequest");
    }
    constructor() {
      throw new TypeError("Illegal constructor");
    }
    get view() {
      if (!Be(this)) throw ot("view");
      return this._view;
    }
    respond(e2) {
      if (!Be(this)) throw ot("respond");
      if (M(e2, 1, "respond"), e2 = N(e2, "First parameter"), void 0 === this._associatedReadableByteStreamController) throw new TypeError("This BYOB request has been invalidated");
      if (de(this._view.buffer)) throw new TypeError("The BYOB request's buffer has been detached and so cannot be used as a response");
      et(this._associatedReadableByteStreamController, e2);
    }
    respondWithNewView(e2) {
      if (!Be(this)) throw ot("respondWithNewView");
      if (M(e2, 1, "respondWithNewView"), !ArrayBuffer.isView(e2)) throw new TypeError("You can only respond with array buffer views");
      if (void 0 === this._associatedReadableByteStreamController) throw new TypeError("This BYOB request has been invalidated");
      if (de(e2.buffer)) throw new TypeError("The given view's buffer has been detached and so cannot be used as a response");
      tt(this._associatedReadableByteStreamController, e2);
    }
  };
  Object.defineProperties(ReadableStreamBYOBRequest.prototype, { respond: { enumerable: true }, respondWithNewView: { enumerable: true }, view: { enumerable: true } }), o(ReadableStreamBYOBRequest.prototype.respond, "respond"), o(ReadableStreamBYOBRequest.prototype.respondWithNewView, "respondWithNewView"), "symbol" == typeof Symbol.toStringTag && Object.defineProperty(ReadableStreamBYOBRequest.prototype, Symbol.toStringTag, { value: "ReadableStreamBYOBRequest", configurable: true });
  var ReadableByteStreamController = class {
    static {
      __name(this, "ReadableByteStreamController");
    }
    constructor() {
      throw new TypeError("Illegal constructor");
    }
    get byobRequest() {
      if (!Oe(this)) throw nt("byobRequest");
      return Ke(this);
    }
    get desiredSize() {
      if (!Oe(this)) throw nt("desiredSize");
      return Ze(this);
    }
    close() {
      if (!Oe(this)) throw nt("close");
      if (this._closeRequested) throw new TypeError("The stream has already been closed; do not close it again!");
      const e2 = this._controlledReadableByteStream._state;
      if ("readable" !== e2) throw new TypeError(`The stream (in ${e2} state) is not in the readable state and cannot be closed`);
      Ue(this);
    }
    enqueue(e2) {
      if (!Oe(this)) throw nt("enqueue");
      if (M(e2, 1, "enqueue"), !ArrayBuffer.isView(e2)) throw new TypeError("chunk must be an array buffer view");
      if (0 === e2.byteLength) throw new TypeError("chunk must have non-zero byteLength");
      if (0 === e2.buffer.byteLength) throw new TypeError("chunk's buffer must have non-zero byteLength");
      if (this._closeRequested) throw new TypeError("stream is closed or draining");
      const t2 = this._controlledReadableByteStream._state;
      if ("readable" !== t2) throw new TypeError(`The stream (in ${t2} state) is not in the readable state and cannot be enqueued to`);
      Ge(this, e2);
    }
    error(e2 = void 0) {
      if (!Oe(this)) throw nt("error");
      Xe(this, e2);
    }
    [T](e2) {
      ke(this), qe(this);
      const t2 = this._cancelAlgorithm(e2);
      return Ve(this), t2;
    }
    [P](e2) {
      const t2 = this._controlledReadableByteStream;
      if (this._queueTotalSize > 0) return void Je(this, e2);
      const r2 = this._autoAllocateChunkSize;
      if (void 0 !== r2) {
        let t3;
        try {
          t3 = new ArrayBuffer(r2);
        } catch (t4) {
          return void e2._errorSteps(t4);
        }
        const o2 = { buffer: t3, bufferByteLength: r2, byteOffset: 0, byteLength: r2, bytesFilled: 0, minimumFill: 1, elementSize: 1, viewConstructor: Uint8Array, readerType: "default" };
        this._pendingPullIntos.push(o2);
      }
      U(t2, e2), je(this);
    }
    [C]() {
      return this._queueTotalSize > 0;
    }
    [q]() {
      if (this._pendingPullIntos.length > 0) {
        const e2 = this._pendingPullIntos.peek();
        e2.readerType = "none", this._pendingPullIntos = new v(), this._pendingPullIntos.push(e2);
      }
    }
  };
  function Oe(e2) {
    return !!t(e2) && (!!Object.prototype.hasOwnProperty.call(e2, "_controlledReadableByteStream") && e2 instanceof ReadableByteStreamController);
  }
  __name(Oe, "Oe");
  function Be(e2) {
    return !!t(e2) && (!!Object.prototype.hasOwnProperty.call(e2, "_associatedReadableByteStreamController") && e2 instanceof ReadableStreamBYOBRequest);
  }
  __name(Be, "Be");
  function je(e2) {
    const t2 = (function(e3) {
      const t3 = e3._controlledReadableByteStream;
      if ("readable" !== t3._state) return false;
      if (e3._closeRequested) return false;
      if (!e3._started) return false;
      if (J(t3) && X(t3) > 0) return true;
      if (ut(t3) && lt(t3) > 0) return true;
      const r2 = Ze(e3);
      if (r2 > 0) return true;
      return false;
    })(e2);
    if (!t2) return;
    if (e2._pulling) return void (e2._pullAgain = true);
    e2._pulling = true;
    h(e2._pullAlgorithm(), () => (e2._pulling = false, e2._pullAgain && (e2._pullAgain = false, je(e2)), null), (t3) => (Xe(e2, t3), null));
  }
  __name(je, "je");
  function ke(e2) {
    xe(e2), e2._pendingPullIntos = new v();
  }
  __name(ke, "ke");
  function Ae(e2, t2) {
    let r2 = false;
    "closed" === e2._state && (r2 = true);
    const o2 = De(t2);
    "default" === t2.readerType ? G(e2, o2, r2) : (function(e3, t3, r3) {
      const o3 = e3._reader, n2 = o3._readIntoRequests.shift();
      r3 ? n2._closeSteps(t3) : n2._chunkSteps(t3);
    })(e2, o2, r2);
  }
  __name(Ae, "Ae");
  function ze(e2, t2) {
    for (let r2 = 0; r2 < t2.length; ++r2) Ae(e2, t2[r2]);
  }
  __name(ze, "ze");
  function De(e2) {
    const t2 = e2.bytesFilled, r2 = e2.elementSize;
    return new e2.viewConstructor(e2.buffer, e2.byteOffset, t2 / r2);
  }
  __name(De, "De");
  function Fe(e2, t2, r2, o2) {
    e2._queue.push({ buffer: t2, byteOffset: r2, byteLength: o2 }), e2._queueTotalSize += o2;
  }
  __name(Fe, "Fe");
  function Le(e2, t2, r2, o2) {
    let n2;
    try {
      n2 = fe(t2, r2, r2 + o2);
    } catch (t3) {
      throw Xe(e2, t3), t3;
    }
    Fe(e2, n2, 0, o2);
  }
  __name(Le, "Le");
  function Ie(e2, t2) {
    t2.bytesFilled > 0 && Le(e2, t2.buffer, t2.byteOffset, t2.bytesFilled), He(e2);
  }
  __name(Ie, "Ie");
  function $e(e2, t2) {
    const r2 = Math.min(e2._queueTotalSize, t2.byteLength - t2.bytesFilled), o2 = t2.bytesFilled + r2;
    let n2 = r2, i2 = false;
    const a3 = o2 - o2 % t2.elementSize;
    a3 >= t2.minimumFill && (n2 = a3 - t2.bytesFilled, i2 = true);
    const s2 = e2._queue;
    for (; n2 > 0; ) {
      const r3 = s2.peek(), o3 = Math.min(n2, r3.byteLength), i3 = t2.byteOffset + t2.bytesFilled;
      ue(t2.buffer, i3, r3.buffer, r3.byteOffset, o3), r3.byteLength === o3 ? s2.shift() : (r3.byteOffset += o3, r3.byteLength -= o3), e2._queueTotalSize -= o3, Me(e2, o3, t2), n2 -= o3;
    }
    return i2;
  }
  __name($e, "$e");
  function Me(e2, t2, r2) {
    r2.bytesFilled += t2;
  }
  __name(Me, "Me");
  function Ye(e2) {
    0 === e2._queueTotalSize && e2._closeRequested ? (Ve(e2), Yr(e2._controlledReadableByteStream)) : je(e2);
  }
  __name(Ye, "Ye");
  function xe(e2) {
    null !== e2._byobRequest && (e2._byobRequest._associatedReadableByteStreamController = void 0, e2._byobRequest._view = null, e2._byobRequest = null);
  }
  __name(xe, "xe");
  function Qe(e2) {
    const t2 = [];
    for (; e2._pendingPullIntos.length > 0 && 0 !== e2._queueTotalSize; ) {
      const r2 = e2._pendingPullIntos.peek();
      $e(e2, r2) && (He(e2), t2.push(r2));
    }
    return t2;
  }
  __name(Qe, "Qe");
  function Ne(e2, t2) {
    const r2 = e2._pendingPullIntos.peek();
    xe(e2);
    "closed" === e2._controlledReadableByteStream._state ? (function(e3, t3) {
      "none" === t3.readerType && He(e3);
      const r3 = e3._controlledReadableByteStream;
      if (ut(r3)) {
        const t4 = [];
        for (; t4.length < lt(r3); ) t4.push(He(e3));
        ze(r3, t4);
      }
    })(e2, r2) : (function(e3, t3, r3) {
      if (Me(0, t3, r3), "none" === r3.readerType) {
        Ie(e3, r3);
        const t4 = Qe(e3);
        return void ze(e3._controlledReadableByteStream, t4);
      }
      if (r3.bytesFilled < r3.minimumFill) return;
      He(e3);
      const o2 = r3.bytesFilled % r3.elementSize;
      if (o2 > 0) {
        const t4 = r3.byteOffset + r3.bytesFilled;
        Le(e3, r3.buffer, t4 - o2, o2);
      }
      r3.bytesFilled -= o2;
      const n2 = Qe(e3);
      Ae(e3._controlledReadableByteStream, r3), ze(e3._controlledReadableByteStream, n2);
    })(e2, t2, r2), je(e2);
  }
  __name(Ne, "Ne");
  function He(e2) {
    return e2._pendingPullIntos.shift();
  }
  __name(He, "He");
  function Ve(e2) {
    e2._pullAlgorithm = void 0, e2._cancelAlgorithm = void 0;
  }
  __name(Ve, "Ve");
  function Ue(e2) {
    const t2 = e2._controlledReadableByteStream;
    if (!e2._closeRequested && "readable" === t2._state) if (e2._queueTotalSize > 0) e2._closeRequested = true;
    else {
      if (e2._pendingPullIntos.length > 0) {
        const t3 = e2._pendingPullIntos.peek();
        if (t3.bytesFilled % t3.elementSize !== 0) {
          const t4 = new TypeError("Insufficient bytes to fill elements in the given buffer");
          throw Xe(e2, t4), t4;
        }
      }
      Ve(e2), Yr(t2);
    }
  }
  __name(Ue, "Ue");
  function Ge(e2, t2) {
    const r2 = e2._controlledReadableByteStream;
    if (e2._closeRequested || "readable" !== r2._state) return;
    const { buffer: o2, byteOffset: n2, byteLength: i2 } = t2;
    if (de(o2)) throw new TypeError("chunk's buffer is detached and so cannot be enqueued");
    const a3 = ce(o2);
    if (e2._pendingPullIntos.length > 0) {
      const t3 = e2._pendingPullIntos.peek();
      if (de(t3.buffer)) throw new TypeError("The BYOB request's buffer has been detached and so cannot be filled with an enqueued chunk");
      xe(e2), t3.buffer = ce(t3.buffer), "none" === t3.readerType && Ie(e2, t3);
    }
    if (J(r2)) if ((function(e3) {
      const t3 = e3._controlledReadableByteStream._reader;
      for (; t3._readRequests.length > 0; ) {
        if (0 === e3._queueTotalSize) return;
        Je(e3, t3._readRequests.shift());
      }
    })(e2), 0 === X(r2)) Fe(e2, a3, n2, i2);
    else {
      e2._pendingPullIntos.length > 0 && He(e2);
      G(r2, new Uint8Array(a3, n2, i2), false);
    }
    else if (ut(r2)) {
      Fe(e2, a3, n2, i2);
      ze(r2, Qe(e2));
    } else Fe(e2, a3, n2, i2);
    je(e2);
  }
  __name(Ge, "Ge");
  function Xe(e2, t2) {
    const r2 = e2._controlledReadableByteStream;
    "readable" === r2._state && (ke(e2), qe(e2), Ve(e2), xr(r2, t2));
  }
  __name(Xe, "Xe");
  function Je(e2, t2) {
    const r2 = e2._queue.shift();
    e2._queueTotalSize -= r2.byteLength, Ye(e2);
    const o2 = new Uint8Array(r2.buffer, r2.byteOffset, r2.byteLength);
    t2._chunkSteps(o2);
  }
  __name(Je, "Je");
  function Ke(e2) {
    if (null === e2._byobRequest && e2._pendingPullIntos.length > 0) {
      const t2 = e2._pendingPullIntos.peek(), r2 = new Uint8Array(t2.buffer, t2.byteOffset + t2.bytesFilled, t2.byteLength - t2.bytesFilled), o2 = Object.create(ReadableStreamBYOBRequest.prototype);
      !(function(e3, t3, r3) {
        e3._associatedReadableByteStreamController = t3, e3._view = r3;
      })(o2, e2, r2), e2._byobRequest = o2;
    }
    return e2._byobRequest;
  }
  __name(Ke, "Ke");
  function Ze(e2) {
    const t2 = e2._controlledReadableByteStream._state;
    return "errored" === t2 ? null : "closed" === t2 ? 0 : e2._strategyHWM - e2._queueTotalSize;
  }
  __name(Ze, "Ze");
  function et(e2, t2) {
    const r2 = e2._pendingPullIntos.peek();
    if ("closed" === e2._controlledReadableByteStream._state) {
      if (0 !== t2) throw new TypeError("bytesWritten must be 0 when calling respond() on a closed stream");
    } else {
      if (0 === t2) throw new TypeError("bytesWritten must be greater than 0 when calling respond() on a readable stream");
      if (r2.bytesFilled + t2 > r2.byteLength) throw new RangeError("bytesWritten out of range");
    }
    r2.buffer = ce(r2.buffer), Ne(e2, t2);
  }
  __name(et, "et");
  function tt(e2, t2) {
    const r2 = e2._pendingPullIntos.peek();
    if ("closed" === e2._controlledReadableByteStream._state) {
      if (0 !== t2.byteLength) throw new TypeError("The view's length must be 0 when calling respondWithNewView() on a closed stream");
    } else if (0 === t2.byteLength) throw new TypeError("The view's length must be greater than 0 when calling respondWithNewView() on a readable stream");
    if (r2.byteOffset + r2.bytesFilled !== t2.byteOffset) throw new RangeError("The region specified by view does not match byobRequest");
    if (r2.bufferByteLength !== t2.buffer.byteLength) throw new RangeError("The buffer of view has different capacity than byobRequest");
    if (r2.bytesFilled + t2.byteLength > r2.byteLength) throw new RangeError("The region specified by view is larger than byobRequest");
    const o2 = t2.byteLength;
    r2.buffer = ce(t2.buffer), Ne(e2, o2);
  }
  __name(tt, "tt");
  function rt(e2, t2, r2, o2, n2, i2, a3) {
    t2._controlledReadableByteStream = e2, t2._pullAgain = false, t2._pulling = false, t2._byobRequest = null, t2._queue = t2._queueTotalSize = void 0, qe(t2), t2._closeRequested = false, t2._started = false, t2._strategyHWM = i2, t2._pullAlgorithm = o2, t2._cancelAlgorithm = n2, t2._autoAllocateChunkSize = a3, t2._pendingPullIntos = new v(), e2._readableStreamController = t2;
    h(c(r2()), () => (t2._started = true, je(t2), null), (e3) => (Xe(t2, e3), null));
  }
  __name(rt, "rt");
  function ot(e2) {
    return new TypeError(`ReadableStreamBYOBRequest.prototype.${e2} can only be used on a ReadableStreamBYOBRequest`);
  }
  __name(ot, "ot");
  function nt(e2) {
    return new TypeError(`ReadableByteStreamController.prototype.${e2} can only be used on a ReadableByteStreamController`);
  }
  __name(nt, "nt");
  function it(e2, t2) {
    if ("byob" !== (e2 = `${e2}`)) throw new TypeError(`${t2} '${e2}' is not a valid enumeration value for ReadableStreamReaderMode`);
    return e2;
  }
  __name(it, "it");
  function at(e2) {
    return new ReadableStreamBYOBReader(e2);
  }
  __name(at, "at");
  function st(e2, t2) {
    e2._reader._readIntoRequests.push(t2);
  }
  __name(st, "st");
  function lt(e2) {
    return e2._reader._readIntoRequests.length;
  }
  __name(lt, "lt");
  function ut(e2) {
    const t2 = e2._reader;
    return void 0 !== t2 && !!ft(t2);
  }
  __name(ut, "ut");
  Object.defineProperties(ReadableByteStreamController.prototype, { close: { enumerable: true }, enqueue: { enumerable: true }, error: { enumerable: true }, byobRequest: { enumerable: true }, desiredSize: { enumerable: true } }), o(ReadableByteStreamController.prototype.close, "close"), o(ReadableByteStreamController.prototype.enqueue, "enqueue"), o(ReadableByteStreamController.prototype.error, "error"), "symbol" == typeof Symbol.toStringTag && Object.defineProperty(ReadableByteStreamController.prototype, Symbol.toStringTag, { value: "ReadableByteStreamController", configurable: true });
  var ReadableStreamBYOBReader = class {
    static {
      __name(this, "ReadableStreamBYOBReader");
    }
    constructor(e2) {
      if (M(e2, 1, "ReadableStreamBYOBReader"), H(e2, "First parameter"), $r(e2)) throw new TypeError("This stream has already been locked for exclusive reading by another reader");
      if (!Oe(e2._readableStreamController)) throw new TypeError("Cannot construct a ReadableStreamBYOBReader for a stream not constructed with a byte source");
      E(this, e2), this._readIntoRequests = new v();
    }
    get closed() {
      return ft(this) ? this._closedPromise : d(_t("closed"));
    }
    cancel(e2 = void 0) {
      return ft(this) ? void 0 === this._ownerReadableStream ? d(B("cancel")) : W(this, e2) : d(_t("cancel"));
    }
    read(e2, t2 = {}) {
      if (!ft(this)) return d(_t("read"));
      if (!ArrayBuffer.isView(e2)) return d(new TypeError("view must be an array buffer view"));
      if (0 === e2.byteLength) return d(new TypeError("view must have non-zero byteLength"));
      if (0 === e2.buffer.byteLength) return d(new TypeError("view's buffer must have non-zero byteLength"));
      if (de(e2.buffer)) return d(new TypeError("view's buffer has been detached"));
      let r2;
      try {
        r2 = (function(e3, t3) {
          var r3;
          return L(e3, t3), { min: N(null !== (r3 = null == e3 ? void 0 : e3.min) && void 0 !== r3 ? r3 : 1, `${t3} has member 'min' that`) };
        })(t2, "options");
      } catch (e3) {
        return d(e3);
      }
      const o2 = r2.min;
      if (0 === o2) return d(new TypeError("options.min must be greater than 0"));
      if ((function(e3) {
        return Ee(e3.constructor);
      })(e2)) {
        if (o2 > e2.byteLength) return d(new RangeError("options.min must be less than or equal to view's byteLength"));
      } else if (o2 > e2.length) return d(new RangeError("options.min must be less than or equal to view's length"));
      if (void 0 === this._ownerReadableStream) return d(B("read from"));
      const n2 = (function(e3, t3, r3) {
        const o3 = e3._ownerReadableStream;
        return "errored" === o3._state || (function(e4, t4, r4) {
          const o4 = e4._controlledReadableByteStream, n3 = We(t4.constructor), { byteLength: i2 } = t4, a3 = r4 * n3;
          return !(e4._pendingPullIntos.length > 0) && ("closed" === o4._state || e4._queueTotalSize >= a3);
        })(o3._readableStreamController, t3, r3);
      })(this, e2, o2) ? new dt() : new ct();
      return ht(this, e2, o2, n2), n2._promise;
    }
    releaseLock() {
      if (!ft(this)) throw _t("releaseLock");
      void 0 !== this._ownerReadableStream && (function(e2) {
        O(e2);
        const t2 = new TypeError("Reader was released");
        bt(e2, t2);
      })(this);
    }
  };
  Object.defineProperties(ReadableStreamBYOBReader.prototype, { cancel: { enumerable: true }, read: { enumerable: true }, releaseLock: { enumerable: true }, closed: { enumerable: true } }), o(ReadableStreamBYOBReader.prototype.cancel, "cancel"), o(ReadableStreamBYOBReader.prototype.read, "read"), o(ReadableStreamBYOBReader.prototype.releaseLock, "releaseLock"), "symbol" == typeof Symbol.toStringTag && Object.defineProperty(ReadableStreamBYOBReader.prototype, Symbol.toStringTag, { value: "ReadableStreamBYOBReader", configurable: true });
  var ct = class {
    static {
      __name(this, "ct");
    }
    constructor() {
      this._promise = u((e2, t2) => {
        this._resolvePromise = e2, this._rejectPromise = t2;
      });
    }
    _chunkSteps(e2) {
      this._resolvePromise({ value: e2, done: false });
    }
    _closeSteps(e2) {
      this._resolvePromise({ value: e2, done: true });
    }
    _errorSteps(e2) {
      this._rejectPromise(e2);
    }
  };
  var dt = class {
    static {
      __name(this, "dt");
    }
    constructor() {
      this._promise = void 0;
    }
    _chunkSteps(e2) {
      this._promise = l({ value: e2, done: false });
    }
    _closeSteps(e2) {
      this._promise = l({ value: e2, done: true });
    }
    _errorSteps(e2) {
      this._promise = d(e2);
    }
  };
  function ft(e2) {
    return !!t(e2) && (!!Object.prototype.hasOwnProperty.call(e2, "_readIntoRequests") && e2 instanceof ReadableStreamBYOBReader);
  }
  __name(ft, "ft");
  function ht(e2, t2, r2, o2) {
    const n2 = e2._ownerReadableStream;
    n2._disturbed = true, "errored" === n2._state ? o2._errorSteps(n2._storedError) : (function(e3, t3, r3, o3) {
      const n3 = e3._controlledReadableByteStream, i2 = t3.constructor, a3 = We(i2), { byteOffset: s2, byteLength: l2 } = t3, u2 = r3 * a3;
      let c2;
      try {
        c2 = ce(t3.buffer);
      } catch (e4) {
        return void o3._errorSteps(e4);
      }
      const d2 = { buffer: c2, bufferByteLength: c2.byteLength, byteOffset: s2, byteLength: l2, bytesFilled: 0, minimumFill: u2, elementSize: a3, viewConstructor: i2, readerType: "byob" };
      if (e3._pendingPullIntos.length > 0) return e3._pendingPullIntos.push(d2), void st(n3, o3);
      if ("closed" === n3._state) {
        const e4 = new i2(d2.buffer, d2.byteOffset, 0);
        return void o3._closeSteps(e4);
      }
      if (e3._queueTotalSize > 0) {
        if ($e(e3, d2)) {
          const t4 = De(d2);
          return Ye(e3), void o3._chunkSteps(t4);
        }
        if (e3._closeRequested) {
          const t4 = new TypeError("Insufficient bytes to fill elements in the given buffer");
          return Xe(e3, t4), void o3._errorSteps(t4);
        }
      }
      e3._pendingPullIntos.push(d2), st(n3, o3), je(e3);
    })(n2._readableStreamController, t2, r2, o2);
  }
  __name(ht, "ht");
  function bt(e2, t2) {
    const r2 = e2._readIntoRequests;
    e2._readIntoRequests = new v(), r2.forEach((e3) => {
      e3._errorSteps(t2);
    });
  }
  __name(bt, "bt");
  function _t(e2) {
    return new TypeError(`ReadableStreamBYOBReader.prototype.${e2} can only be used on a ReadableStreamBYOBReader`);
  }
  __name(_t, "_t");
  function mt(e2, t2) {
    const { highWaterMark: r2 } = e2;
    if (void 0 === r2) return t2;
    if (Re(r2) || r2 < 0) throw new RangeError("Invalid highWaterMark");
    return r2;
  }
  __name(mt, "mt");
  function pt(e2) {
    const { size: t2 } = e2;
    return t2 || (() => 1);
  }
  __name(pt, "pt");
  function yt(e2, t2) {
    L(e2, t2);
    const r2 = null == e2 ? void 0 : e2.highWaterMark, o2 = null == e2 ? void 0 : e2.size;
    return { highWaterMark: void 0 === r2 ? void 0 : x(r2), size: void 0 === o2 ? void 0 : St(o2, `${t2} has member 'size' that`) };
  }
  __name(yt, "yt");
  function St(e2, t2) {
    return I(e2, t2), (t3) => x(e2(t3));
  }
  __name(St, "St");
  function gt(e2, t2, r2) {
    return I(e2, r2), (r3) => g(e2, t2, [r3]);
  }
  __name(gt, "gt");
  function vt(e2, t2, r2) {
    return I(e2, r2), () => g(e2, t2, []);
  }
  __name(vt, "vt");
  function wt(e2, t2, r2) {
    return I(e2, r2), (r3) => S(e2, t2, [r3]);
  }
  __name(wt, "wt");
  function Rt(e2, t2, r2) {
    return I(e2, r2), (r3, o2) => g(e2, t2, [r3, o2]);
  }
  __name(Rt, "Rt");
  function Tt(e2, t2) {
    if (!qt(e2)) throw new TypeError(`${t2} is not a WritableStream.`);
  }
  __name(Tt, "Tt");
  var WritableStream = class {
    static {
      __name(this, "WritableStream");
    }
    constructor(e2 = {}, t2 = {}) {
      void 0 === e2 ? e2 = null : $(e2, "First parameter");
      const r2 = yt(t2, "Second parameter"), o2 = (function(e3, t3) {
        L(e3, t3);
        const r3 = null == e3 ? void 0 : e3.abort, o3 = null == e3 ? void 0 : e3.close, n3 = null == e3 ? void 0 : e3.start, i2 = null == e3 ? void 0 : e3.type, a3 = null == e3 ? void 0 : e3.write;
        return { abort: void 0 === r3 ? void 0 : gt(r3, e3, `${t3} has member 'abort' that`), close: void 0 === o3 ? void 0 : vt(o3, e3, `${t3} has member 'close' that`), start: void 0 === n3 ? void 0 : wt(n3, e3, `${t3} has member 'start' that`), write: void 0 === a3 ? void 0 : Rt(a3, e3, `${t3} has member 'write' that`), type: i2 };
      })(e2, "First parameter");
      Ct(this);
      if (void 0 !== o2.type) throw new RangeError("Invalid type is specified");
      const n2 = pt(r2);
      !(function(e3, t3, r3, o3) {
        const n3 = Object.create(WritableStreamDefaultController.prototype);
        let i2, a3, s2, l2;
        i2 = void 0 !== t3.start ? () => t3.start(n3) : () => {
        };
        a3 = void 0 !== t3.write ? (e4) => t3.write(e4, n3) : () => c(void 0);
        s2 = void 0 !== t3.close ? () => t3.close() : () => c(void 0);
        l2 = void 0 !== t3.abort ? (e4) => t3.abort(e4) : () => c(void 0);
        Nt(e3, n3, i2, a3, s2, l2, r3, o3);
      })(this, o2, mt(r2, 1), n2);
    }
    get locked() {
      if (!qt(this)) throw Kt("locked");
      return Et(this);
    }
    abort(e2 = void 0) {
      return qt(this) ? Et(this) ? d(new TypeError("Cannot abort a stream that already has a writer")) : Wt(this, e2) : d(Kt("abort"));
    }
    close() {
      return qt(this) ? Et(this) ? d(new TypeError("Cannot close a stream that already has a writer")) : At(this) ? d(new TypeError("Cannot close an already-closing stream")) : Ot(this) : d(Kt("close"));
    }
    getWriter() {
      if (!qt(this)) throw Kt("getWriter");
      return Pt(this);
    }
  };
  function Pt(e2) {
    return new WritableStreamDefaultWriter(e2);
  }
  __name(Pt, "Pt");
  function Ct(e2) {
    e2._state = "writable", e2._storedError = void 0, e2._writer = void 0, e2._writableStreamController = void 0, e2._writeRequests = new v(), e2._inFlightWriteRequest = void 0, e2._closeRequest = void 0, e2._inFlightCloseRequest = void 0, e2._pendingAbortRequest = void 0, e2._backpressure = false;
  }
  __name(Ct, "Ct");
  function qt(e2) {
    return !!t(e2) && (!!Object.prototype.hasOwnProperty.call(e2, "_writableStreamController") && e2 instanceof WritableStream);
  }
  __name(qt, "qt");
  function Et(e2) {
    return void 0 !== e2._writer;
  }
  __name(Et, "Et");
  function Wt(e2, t2) {
    var r2;
    if ("closed" === e2._state || "errored" === e2._state) return c(void 0);
    e2._writableStreamController._abortReason = t2, null === (r2 = e2._writableStreamController._abortController) || void 0 === r2 || r2.abort(t2);
    const o2 = e2._state;
    if ("closed" === o2 || "errored" === o2) return c(void 0);
    if (void 0 !== e2._pendingAbortRequest) return e2._pendingAbortRequest._promise;
    let n2 = false;
    "erroring" === o2 && (n2 = true, t2 = void 0);
    const i2 = u((r3, o3) => {
      e2._pendingAbortRequest = { _promise: void 0, _resolve: r3, _reject: o3, _reason: t2, _wasAlreadyErroring: n2 };
    });
    return e2._pendingAbortRequest._promise = i2, n2 || jt(e2, t2), i2;
  }
  __name(Wt, "Wt");
  function Ot(e2) {
    const t2 = e2._state;
    if ("closed" === t2 || "errored" === t2) return d(new TypeError(`The stream (in ${t2} state) is not in the writable state and cannot be closed`));
    const r2 = u((t3, r3) => {
      const o3 = { _resolve: t3, _reject: r3 };
      e2._closeRequest = o3;
    }), o2 = e2._writer;
    var n2;
    return void 0 !== o2 && e2._backpressure && "writable" === t2 && cr(o2), Ce(n2 = e2._writableStreamController, xt, 0), Ut(n2), r2;
  }
  __name(Ot, "Ot");
  function Bt(e2, t2) {
    "writable" !== e2._state ? kt(e2) : jt(e2, t2);
  }
  __name(Bt, "Bt");
  function jt(e2, t2) {
    const r2 = e2._writableStreamController;
    e2._state = "erroring", e2._storedError = t2;
    const o2 = e2._writer;
    void 0 !== o2 && $t(o2, t2), !(function(e3) {
      if (void 0 === e3._inFlightWriteRequest && void 0 === e3._inFlightCloseRequest) return false;
      return true;
    })(e2) && r2._started && kt(e2);
  }
  __name(jt, "jt");
  function kt(e2) {
    e2._state = "errored", e2._writableStreamController[R]();
    const t2 = e2._storedError;
    if (e2._writeRequests.forEach((e3) => {
      e3._reject(t2);
    }), e2._writeRequests = new v(), void 0 === e2._pendingAbortRequest) return void zt(e2);
    const r2 = e2._pendingAbortRequest;
    if (e2._pendingAbortRequest = void 0, r2._wasAlreadyErroring) return r2._reject(t2), void zt(e2);
    h(e2._writableStreamController[w](r2._reason), () => (r2._resolve(), zt(e2), null), (t3) => (r2._reject(t3), zt(e2), null));
  }
  __name(kt, "kt");
  function At(e2) {
    return void 0 !== e2._closeRequest || void 0 !== e2._inFlightCloseRequest;
  }
  __name(At, "At");
  function zt(e2) {
    void 0 !== e2._closeRequest && (e2._closeRequest._reject(e2._storedError), e2._closeRequest = void 0);
    const t2 = e2._writer;
    void 0 !== t2 && nr(t2, e2._storedError);
  }
  __name(zt, "zt");
  function Dt(e2, t2) {
    const r2 = e2._writer;
    void 0 !== r2 && t2 !== e2._backpressure && (t2 ? (function(e3) {
      ar(e3);
    })(r2) : cr(r2)), e2._backpressure = t2;
  }
  __name(Dt, "Dt");
  Object.defineProperties(WritableStream.prototype, { abort: { enumerable: true }, close: { enumerable: true }, getWriter: { enumerable: true }, locked: { enumerable: true } }), o(WritableStream.prototype.abort, "abort"), o(WritableStream.prototype.close, "close"), o(WritableStream.prototype.getWriter, "getWriter"), "symbol" == typeof Symbol.toStringTag && Object.defineProperty(WritableStream.prototype, Symbol.toStringTag, { value: "WritableStream", configurable: true });
  var WritableStreamDefaultWriter = class {
    static {
      __name(this, "WritableStreamDefaultWriter");
    }
    constructor(e2) {
      if (M(e2, 1, "WritableStreamDefaultWriter"), Tt(e2, "First parameter"), Et(e2)) throw new TypeError("This stream has already been locked for exclusive writing by another writer");
      this._ownerWritableStream = e2, e2._writer = this;
      const t2 = e2._state;
      if ("writable" === t2) !At(e2) && e2._backpressure ? ar(this) : lr(this), rr(this);
      else if ("erroring" === t2) sr(this, e2._storedError), rr(this);
      else if ("closed" === t2) lr(this), rr(r2 = this), ir(r2);
      else {
        const t3 = e2._storedError;
        sr(this, t3), or(this, t3);
      }
      var r2;
    }
    get closed() {
      return Ft(this) ? this._closedPromise : d(er("closed"));
    }
    get desiredSize() {
      if (!Ft(this)) throw er("desiredSize");
      if (void 0 === this._ownerWritableStream) throw tr("desiredSize");
      return (function(e2) {
        const t2 = e2._ownerWritableStream, r2 = t2._state;
        if ("errored" === r2 || "erroring" === r2) return null;
        if ("closed" === r2) return 0;
        return Vt(t2._writableStreamController);
      })(this);
    }
    get ready() {
      return Ft(this) ? this._readyPromise : d(er("ready"));
    }
    abort(e2 = void 0) {
      return Ft(this) ? void 0 === this._ownerWritableStream ? d(tr("abort")) : (function(e3, t2) {
        return Wt(e3._ownerWritableStream, t2);
      })(this, e2) : d(er("abort"));
    }
    close() {
      if (!Ft(this)) return d(er("close"));
      const e2 = this._ownerWritableStream;
      return void 0 === e2 ? d(tr("close")) : At(e2) ? d(new TypeError("Cannot close an already-closing stream")) : Lt(this);
    }
    releaseLock() {
      if (!Ft(this)) throw er("releaseLock");
      void 0 !== this._ownerWritableStream && Mt(this);
    }
    write(e2 = void 0) {
      return Ft(this) ? void 0 === this._ownerWritableStream ? d(tr("write to")) : Yt(this, e2) : d(er("write"));
    }
  };
  function Ft(e2) {
    return !!t(e2) && (!!Object.prototype.hasOwnProperty.call(e2, "_ownerWritableStream") && e2 instanceof WritableStreamDefaultWriter);
  }
  __name(Ft, "Ft");
  function Lt(e2) {
    return Ot(e2._ownerWritableStream);
  }
  __name(Lt, "Lt");
  function It(e2, t2) {
    "pending" === e2._closedPromiseState ? nr(e2, t2) : (function(e3, t3) {
      or(e3, t3);
    })(e2, t2);
  }
  __name(It, "It");
  function $t(e2, t2) {
    "pending" === e2._readyPromiseState ? ur(e2, t2) : (function(e3, t3) {
      sr(e3, t3);
    })(e2, t2);
  }
  __name($t, "$t");
  function Mt(e2) {
    const t2 = e2._ownerWritableStream, r2 = new TypeError("Writer was released and can no longer be used to monitor the stream's closedness");
    $t(e2, r2), It(e2, r2), t2._writer = void 0, e2._ownerWritableStream = void 0;
  }
  __name(Mt, "Mt");
  function Yt(e2, t2) {
    const r2 = e2._ownerWritableStream, o2 = r2._writableStreamController, n2 = (function(e3, t3) {
      if (void 0 === e3._strategySizeAlgorithm) return 1;
      try {
        return e3._strategySizeAlgorithm(t3);
      } catch (t4) {
        return Gt(e3, t4), 1;
      }
    })(o2, t2);
    if (r2 !== e2._ownerWritableStream) return d(tr("write to"));
    const i2 = r2._state;
    if ("errored" === i2) return d(r2._storedError);
    if (At(r2) || "closed" === i2) return d(new TypeError("The stream is closing or closed and cannot be written to"));
    if ("erroring" === i2) return d(r2._storedError);
    const a3 = (function(e3) {
      return u((t3, r3) => {
        const o3 = { _resolve: t3, _reject: r3 };
        e3._writeRequests.push(o3);
      });
    })(r2);
    return (function(e3, t3, r3) {
      try {
        Ce(e3, t3, r3);
      } catch (t4) {
        return void Gt(e3, t4);
      }
      const o3 = e3._controlledWritableStream;
      if (!At(o3) && "writable" === o3._state) {
        Dt(o3, Xt(e3));
      }
      Ut(e3);
    })(o2, t2, n2), a3;
  }
  __name(Yt, "Yt");
  Object.defineProperties(WritableStreamDefaultWriter.prototype, { abort: { enumerable: true }, close: { enumerable: true }, releaseLock: { enumerable: true }, write: { enumerable: true }, closed: { enumerable: true }, desiredSize: { enumerable: true }, ready: { enumerable: true } }), o(WritableStreamDefaultWriter.prototype.abort, "abort"), o(WritableStreamDefaultWriter.prototype.close, "close"), o(WritableStreamDefaultWriter.prototype.releaseLock, "releaseLock"), o(WritableStreamDefaultWriter.prototype.write, "write"), "symbol" == typeof Symbol.toStringTag && Object.defineProperty(WritableStreamDefaultWriter.prototype, Symbol.toStringTag, { value: "WritableStreamDefaultWriter", configurable: true });
  var xt = {};
  var WritableStreamDefaultController = class {
    static {
      __name(this, "WritableStreamDefaultController");
    }
    constructor() {
      throw new TypeError("Illegal constructor");
    }
    get abortReason() {
      if (!Qt(this)) throw Zt("abortReason");
      return this._abortReason;
    }
    get signal() {
      if (!Qt(this)) throw Zt("signal");
      if (void 0 === this._abortController) throw new TypeError("WritableStreamDefaultController.prototype.signal is not supported");
      return this._abortController.signal;
    }
    error(e2 = void 0) {
      if (!Qt(this)) throw Zt("error");
      "writable" === this._controlledWritableStream._state && Jt(this, e2);
    }
    [w](e2) {
      const t2 = this._abortAlgorithm(e2);
      return Ht(this), t2;
    }
    [R]() {
      qe(this);
    }
  };
  function Qt(e2) {
    return !!t(e2) && (!!Object.prototype.hasOwnProperty.call(e2, "_controlledWritableStream") && e2 instanceof WritableStreamDefaultController);
  }
  __name(Qt, "Qt");
  function Nt(e2, t2, r2, o2, n2, i2, a3, s2) {
    t2._controlledWritableStream = e2, e2._writableStreamController = t2, t2._queue = void 0, t2._queueTotalSize = void 0, qe(t2), t2._abortReason = void 0, t2._abortController = (function() {
      if ("function" == typeof AbortController) return new AbortController();
    })(), t2._started = false, t2._strategySizeAlgorithm = s2, t2._strategyHWM = a3, t2._writeAlgorithm = o2, t2._closeAlgorithm = n2, t2._abortAlgorithm = i2;
    const l2 = Xt(t2);
    Dt(e2, l2);
    h(c(r2()), () => (t2._started = true, Ut(t2), null), (r3) => (t2._started = true, Bt(e2, r3), null));
  }
  __name(Nt, "Nt");
  function Ht(e2) {
    e2._writeAlgorithm = void 0, e2._closeAlgorithm = void 0, e2._abortAlgorithm = void 0, e2._strategySizeAlgorithm = void 0;
  }
  __name(Ht, "Ht");
  function Vt(e2) {
    return e2._strategyHWM - e2._queueTotalSize;
  }
  __name(Vt, "Vt");
  function Ut(e2) {
    const t2 = e2._controlledWritableStream;
    if (!e2._started) return;
    if (void 0 !== t2._inFlightWriteRequest) return;
    if ("erroring" === t2._state) return void kt(t2);
    if (0 === e2._queue.length) return;
    const r2 = e2._queue.peek().value;
    r2 === xt ? (function(e3) {
      const t3 = e3._controlledWritableStream;
      (function(e4) {
        e4._inFlightCloseRequest = e4._closeRequest, e4._closeRequest = void 0;
      })(t3), Pe(e3);
      const r3 = e3._closeAlgorithm();
      Ht(e3), h(r3, () => ((function(e4) {
        e4._inFlightCloseRequest._resolve(void 0), e4._inFlightCloseRequest = void 0, "erroring" === e4._state && (e4._storedError = void 0, void 0 !== e4._pendingAbortRequest && (e4._pendingAbortRequest._resolve(), e4._pendingAbortRequest = void 0)), e4._state = "closed";
        const t4 = e4._writer;
        void 0 !== t4 && ir(t4);
      })(t3), null), (e4) => ((function(e5, t4) {
        e5._inFlightCloseRequest._reject(t4), e5._inFlightCloseRequest = void 0, void 0 !== e5._pendingAbortRequest && (e5._pendingAbortRequest._reject(t4), e5._pendingAbortRequest = void 0), Bt(e5, t4);
      })(t3, e4), null));
    })(e2) : (function(e3, t3) {
      const r3 = e3._controlledWritableStream;
      !(function(e4) {
        e4._inFlightWriteRequest = e4._writeRequests.shift();
      })(r3);
      const o2 = e3._writeAlgorithm(t3);
      h(o2, () => {
        !(function(e4) {
          e4._inFlightWriteRequest._resolve(void 0), e4._inFlightWriteRequest = void 0;
        })(r3);
        const t4 = r3._state;
        if (Pe(e3), !At(r3) && "writable" === t4) {
          const t5 = Xt(e3);
          Dt(r3, t5);
        }
        return Ut(e3), null;
      }, (t4) => ("writable" === r3._state && Ht(e3), (function(e4, t5) {
        e4._inFlightWriteRequest._reject(t5), e4._inFlightWriteRequest = void 0, Bt(e4, t5);
      })(r3, t4), null));
    })(e2, r2);
  }
  __name(Ut, "Ut");
  function Gt(e2, t2) {
    "writable" === e2._controlledWritableStream._state && Jt(e2, t2);
  }
  __name(Gt, "Gt");
  function Xt(e2) {
    return Vt(e2) <= 0;
  }
  __name(Xt, "Xt");
  function Jt(e2, t2) {
    const r2 = e2._controlledWritableStream;
    Ht(e2), jt(r2, t2);
  }
  __name(Jt, "Jt");
  function Kt(e2) {
    return new TypeError(`WritableStream.prototype.${e2} can only be used on a WritableStream`);
  }
  __name(Kt, "Kt");
  function Zt(e2) {
    return new TypeError(`WritableStreamDefaultController.prototype.${e2} can only be used on a WritableStreamDefaultController`);
  }
  __name(Zt, "Zt");
  function er(e2) {
    return new TypeError(`WritableStreamDefaultWriter.prototype.${e2} can only be used on a WritableStreamDefaultWriter`);
  }
  __name(er, "er");
  function tr(e2) {
    return new TypeError("Cannot " + e2 + " a stream using a released writer");
  }
  __name(tr, "tr");
  function rr(e2) {
    e2._closedPromise = u((t2, r2) => {
      e2._closedPromise_resolve = t2, e2._closedPromise_reject = r2, e2._closedPromiseState = "pending";
    });
  }
  __name(rr, "rr");
  function or(e2, t2) {
    rr(e2), nr(e2, t2);
  }
  __name(or, "or");
  function nr(e2, t2) {
    void 0 !== e2._closedPromise_reject && (p(e2._closedPromise), e2._closedPromise_reject(t2), e2._closedPromise_resolve = void 0, e2._closedPromise_reject = void 0, e2._closedPromiseState = "rejected");
  }
  __name(nr, "nr");
  function ir(e2) {
    void 0 !== e2._closedPromise_resolve && (e2._closedPromise_resolve(void 0), e2._closedPromise_resolve = void 0, e2._closedPromise_reject = void 0, e2._closedPromiseState = "resolved");
  }
  __name(ir, "ir");
  function ar(e2) {
    e2._readyPromise = u((t2, r2) => {
      e2._readyPromise_resolve = t2, e2._readyPromise_reject = r2;
    }), e2._readyPromiseState = "pending";
  }
  __name(ar, "ar");
  function sr(e2, t2) {
    ar(e2), ur(e2, t2);
  }
  __name(sr, "sr");
  function lr(e2) {
    ar(e2), cr(e2);
  }
  __name(lr, "lr");
  function ur(e2, t2) {
    void 0 !== e2._readyPromise_reject && (p(e2._readyPromise), e2._readyPromise_reject(t2), e2._readyPromise_resolve = void 0, e2._readyPromise_reject = void 0, e2._readyPromiseState = "rejected");
  }
  __name(ur, "ur");
  function cr(e2) {
    void 0 !== e2._readyPromise_resolve && (e2._readyPromise_resolve(void 0), e2._readyPromise_resolve = void 0, e2._readyPromise_reject = void 0, e2._readyPromiseState = "fulfilled");
  }
  __name(cr, "cr");
  Object.defineProperties(WritableStreamDefaultController.prototype, { abortReason: { enumerable: true }, signal: { enumerable: true }, error: { enumerable: true } }), "symbol" == typeof Symbol.toStringTag && Object.defineProperty(WritableStreamDefaultController.prototype, Symbol.toStringTag, { value: "WritableStreamDefaultController", configurable: true });
  var dr = "undefined" != typeof globalThis ? globalThis : "undefined" != typeof self ? self : "undefined" != typeof global ? global : void 0;
  var fr = (function() {
    const e2 = null == dr ? void 0 : dr.DOMException;
    return (function(e3) {
      if ("function" != typeof e3 && "object" != typeof e3) return false;
      if ("DOMException" !== e3.name) return false;
      try {
        return new e3(), true;
      } catch (e4) {
        return false;
      }
    })(e2) ? e2 : void 0;
  })() || (function() {
    const e2 = /* @__PURE__ */ __name(function(e3, t2) {
      this.message = e3 || "", this.name = t2 || "Error", Error.captureStackTrace && Error.captureStackTrace(this, this.constructor);
    }, "e");
    return o(e2, "DOMException"), e2.prototype = Object.create(Error.prototype), Object.defineProperty(e2.prototype, "constructor", { value: e2, writable: true, configurable: true }), e2;
  })();
  function hr(e2, t2, r2, o2, n2, i2) {
    const a3 = V(e2), s2 = Pt(t2);
    e2._disturbed = true;
    const l2 = new br(s2), _3 = new mr(l2);
    return u((m2, y2) => {
      let S2;
      if (void 0 !== i2) {
        if (S2 = /* @__PURE__ */ __name(() => {
          const r3 = void 0 !== i2.reason ? i2.reason : new fr("Aborted", "AbortError"), a4 = [];
          o2 || a4.push(() => "writable" === t2._state ? Wt(t2, r3) : c(void 0)), n2 || a4.push(() => "readable" === e2._state ? Mr(e2, r3) : c(void 0)), T3(() => Promise.all(a4.map((e3) => e3())), true, r3);
        }, "S"), i2.aborted) return void S2();
        i2.addEventListener("abort", S2);
      }
      function g2() {
        for (; !l2._shuttingDown && !t2._backpressure && "writable" === t2._state && !At(t2) && "readable" === e2._state && re(a3); ) te(a3, _3);
        if (l2._shuttingDown) return c(true);
        if (t2._backpressure) return f(s2._readyPromise, g2);
        const r3 = new _r(l2);
        return te(a3, r3), r3._promise;
      }
      __name(g2, "g");
      var v3, w3, R3;
      if (pr(e2, a3._closedPromise, (e3) => (o2 ? P3(true, e3) : T3(() => Wt(t2, e3), true, e3), null)), pr(t2, s2._closedPromise, (t3) => (n2 ? P3(true, t3) : T3(() => Mr(e2, t3), true, t3), null)), v3 = e2, w3 = a3._closedPromise, R3 = /* @__PURE__ */ __name(() => (r2 ? P3() : T3(() => (function(e3) {
        const t3 = e3._ownerWritableStream, r3 = t3._state;
        return At(t3) || "closed" === r3 ? c(void 0) : "errored" === r3 ? d(t3._storedError) : Lt(e3);
      })(s2)), null), "R"), "closed" === v3._state ? R3() : b(w3, R3), At(t2) || "closed" === t2._state) {
        const t3 = new TypeError("the destination writable stream closed before all data could be piped to it");
        n2 ? P3(true, t3) : T3(() => Mr(e2, t3), true, t3);
      }
      function T3(e3, r3, o3) {
        function n3() {
          return h(e3(), () => C3(r3, o3), (e4) => C3(true, e4)), null;
        }
        __name(n3, "n");
        l2._shuttingDown || (l2._shuttingDown = true, "writable" !== t2._state || At(t2) ? n3() : b(l2._waitForWritesToFinish(), n3));
      }
      __name(T3, "T");
      function P3(e3, r3) {
        l2._shuttingDown || (l2._shuttingDown = true, "writable" !== t2._state || At(t2) ? C3(e3, r3) : b(l2._waitForWritesToFinish(), () => C3(e3, r3)));
      }
      __name(P3, "P");
      function C3(e3, t3) {
        return Mt(s2), O(a3), void 0 !== i2 && i2.removeEventListener("abort", S2), e3 ? y2(t3) : m2(void 0), null;
      }
      __name(C3, "C");
      p(u((e3, t3) => {
        !(/* @__PURE__ */ __name(function r3(o3) {
          o3 ? e3() : f(g2(), r3, t3);
        }, "r"))(false);
      }));
    });
  }
  __name(hr, "hr");
  var br = class {
    static {
      __name(this, "br");
    }
    constructor(e2) {
      this._writer = e2, this._shuttingDown = false, this._currentWrite = c(void 0);
    }
    _waitForWritesToFinish() {
      const e2 = this._currentWrite;
      return f(this._currentWrite, () => e2 !== this._currentWrite ? this._waitForWritesToFinish() : void 0);
    }
  };
  var _r = class {
    static {
      __name(this, "_r");
    }
    constructor(e2) {
      this._state = e2, this._promise = u((e3, t2) => {
        this._resolvePromise = e3, this._rejectPromise = t2;
      });
    }
    _chunkSteps(t2) {
      this._state._currentWrite = f(Yt(this._state._writer, t2), void 0, e), this._resolvePromise(false);
    }
    _closeSteps() {
      this._resolvePromise(true);
    }
    _errorSteps(e2) {
      this._rejectPromise(e2);
    }
  };
  var mr = class {
    static {
      __name(this, "mr");
    }
    constructor(e2) {
      this._state = e2;
    }
    _chunkSteps(t2) {
      this._state._currentWrite = f(Yt(this._state._writer, t2), void 0, e);
    }
    _closeSteps() {
    }
    _errorSteps(e2) {
    }
  };
  function pr(e2, t2, r2) {
    "errored" === e2._state ? r2(e2._storedError) : _(t2, r2);
  }
  __name(pr, "pr");
  var ReadableStreamDefaultController = class {
    static {
      __name(this, "ReadableStreamDefaultController");
    }
    constructor() {
      throw new TypeError("Illegal constructor");
    }
    get desiredSize() {
      if (!yr(this)) throw Er("desiredSize");
      return Pr(this);
    }
    close() {
      if (!yr(this)) throw Er("close");
      if (!Cr(this)) throw new TypeError("The stream is not in a state that permits close");
      wr(this);
    }
    enqueue(e2 = void 0) {
      if (!yr(this)) throw Er("enqueue");
      if (!Cr(this)) throw new TypeError("The stream is not in a state that permits enqueue");
      return Rr(this, e2);
    }
    error(e2 = void 0) {
      if (!yr(this)) throw Er("error");
      Tr(this, e2);
    }
    [T](e2) {
      qe(this);
      const t2 = this._cancelAlgorithm(e2);
      return vr(this), t2;
    }
    [P](e2) {
      const t2 = this._controlledReadableStream;
      if (this._queue.length > 0) {
        const r2 = Pe(this);
        this._closeRequested && 0 === this._queue.length ? (vr(this), Yr(t2)) : Sr(this), e2._chunkSteps(r2);
      } else U(t2, e2), Sr(this);
    }
    [C]() {
      return this._queue.length > 0;
    }
    [q]() {
    }
  };
  function yr(e2) {
    return !!t(e2) && (!!Object.prototype.hasOwnProperty.call(e2, "_controlledReadableStream") && e2 instanceof ReadableStreamDefaultController);
  }
  __name(yr, "yr");
  function Sr(e2) {
    if (!gr(e2)) return;
    if (e2._pulling) return void (e2._pullAgain = true);
    e2._pulling = true;
    h(e2._pullAlgorithm(), () => (e2._pulling = false, e2._pullAgain && (e2._pullAgain = false, Sr(e2)), null), (t2) => (Tr(e2, t2), null));
  }
  __name(Sr, "Sr");
  function gr(e2) {
    const t2 = e2._controlledReadableStream;
    if (!Cr(e2)) return false;
    if (!e2._started) return false;
    if ($r(t2) && X(t2) > 0) return true;
    return Pr(e2) > 0;
  }
  __name(gr, "gr");
  function vr(e2) {
    e2._pullAlgorithm = void 0, e2._cancelAlgorithm = void 0, e2._strategySizeAlgorithm = void 0;
  }
  __name(vr, "vr");
  function wr(e2) {
    if (!Cr(e2)) return;
    const t2 = e2._controlledReadableStream;
    e2._closeRequested = true, 0 === e2._queue.length && (vr(e2), Yr(t2));
  }
  __name(wr, "wr");
  function Rr(e2, t2) {
    if (!Cr(e2)) return;
    const r2 = e2._controlledReadableStream;
    if ($r(r2) && X(r2) > 0) G(r2, t2, false);
    else {
      let r3;
      try {
        r3 = e2._strategySizeAlgorithm(t2);
      } catch (t3) {
        throw Tr(e2, t3), t3;
      }
      try {
        Ce(e2, t2, r3);
      } catch (t3) {
        throw Tr(e2, t3), t3;
      }
    }
    Sr(e2);
  }
  __name(Rr, "Rr");
  function Tr(e2, t2) {
    const r2 = e2._controlledReadableStream;
    "readable" === r2._state && (qe(e2), vr(e2), xr(r2, t2));
  }
  __name(Tr, "Tr");
  function Pr(e2) {
    const t2 = e2._controlledReadableStream._state;
    return "errored" === t2 ? null : "closed" === t2 ? 0 : e2._strategyHWM - e2._queueTotalSize;
  }
  __name(Pr, "Pr");
  function Cr(e2) {
    const t2 = e2._controlledReadableStream._state;
    return !e2._closeRequested && "readable" === t2;
  }
  __name(Cr, "Cr");
  function qr(e2, t2, r2, o2, n2, i2, a3) {
    t2._controlledReadableStream = e2, t2._queue = void 0, t2._queueTotalSize = void 0, qe(t2), t2._started = false, t2._closeRequested = false, t2._pullAgain = false, t2._pulling = false, t2._strategySizeAlgorithm = a3, t2._strategyHWM = i2, t2._pullAlgorithm = o2, t2._cancelAlgorithm = n2, e2._readableStreamController = t2;
    h(c(r2()), () => (t2._started = true, Sr(t2), null), (e3) => (Tr(t2, e3), null));
  }
  __name(qr, "qr");
  function Er(e2) {
    return new TypeError(`ReadableStreamDefaultController.prototype.${e2} can only be used on a ReadableStreamDefaultController`);
  }
  __name(Er, "Er");
  function Wr(e2, t2) {
    return Oe(e2._readableStreamController) ? (function(e3) {
      let t3, r2, o2, n2, i2, a3 = V(e3), s2 = false, l2 = false, d2 = false, f2 = false, h2 = false;
      const b3 = u((e4) => {
        i2 = e4;
      });
      function m2(e4) {
        _(e4._closedPromise, (t4) => (e4 !== a3 || (Xe(o2._readableStreamController, t4), Xe(n2._readableStreamController, t4), f2 && h2 || i2(void 0)), null));
      }
      __name(m2, "m");
      function p2() {
        ft(a3) && (O(a3), a3 = V(e3), m2(a3));
        te(a3, { _chunkSteps: /* @__PURE__ */ __name((t4) => {
          y(() => {
            l2 = false, d2 = false;
            const r3 = t4;
            let a4 = t4;
            if (!f2 && !h2) try {
              a4 = Te(t4);
            } catch (t5) {
              return Xe(o2._readableStreamController, t5), Xe(n2._readableStreamController, t5), void i2(Mr(e3, t5));
            }
            f2 || Ge(o2._readableStreamController, r3), h2 || Ge(n2._readableStreamController, a4), s2 = false, l2 ? g2() : d2 && v3();
          });
        }, "_chunkSteps"), _closeSteps: /* @__PURE__ */ __name(() => {
          s2 = false, f2 || Ue(o2._readableStreamController), h2 || Ue(n2._readableStreamController), o2._readableStreamController._pendingPullIntos.length > 0 && et(o2._readableStreamController, 0), n2._readableStreamController._pendingPullIntos.length > 0 && et(n2._readableStreamController, 0), f2 && h2 || i2(void 0);
        }, "_closeSteps"), _errorSteps: /* @__PURE__ */ __name(() => {
          s2 = false;
        }, "_errorSteps") });
      }
      __name(p2, "p");
      function S2(t4, r3) {
        ee(a3) && (O(a3), a3 = at(e3), m2(a3));
        const u2 = r3 ? n2 : o2, c2 = r3 ? o2 : n2;
        ht(a3, t4, 1, { _chunkSteps: /* @__PURE__ */ __name((t5) => {
          y(() => {
            l2 = false, d2 = false;
            const o3 = r3 ? h2 : f2;
            if (r3 ? f2 : h2) o3 || tt(u2._readableStreamController, t5);
            else {
              let r4;
              try {
                r4 = Te(t5);
              } catch (t6) {
                return Xe(u2._readableStreamController, t6), Xe(c2._readableStreamController, t6), void i2(Mr(e3, t6));
              }
              o3 || tt(u2._readableStreamController, t5), Ge(c2._readableStreamController, r4);
            }
            s2 = false, l2 ? g2() : d2 && v3();
          });
        }, "_chunkSteps"), _closeSteps: /* @__PURE__ */ __name((e4) => {
          s2 = false;
          const t5 = r3 ? h2 : f2, o3 = r3 ? f2 : h2;
          t5 || Ue(u2._readableStreamController), o3 || Ue(c2._readableStreamController), void 0 !== e4 && (t5 || tt(u2._readableStreamController, e4), !o3 && c2._readableStreamController._pendingPullIntos.length > 0 && et(c2._readableStreamController, 0)), t5 && o3 || i2(void 0);
        }, "_closeSteps"), _errorSteps: /* @__PURE__ */ __name(() => {
          s2 = false;
        }, "_errorSteps") });
      }
      __name(S2, "S");
      function g2() {
        if (s2) return l2 = true, c(void 0);
        s2 = true;
        const e4 = Ke(o2._readableStreamController);
        return null === e4 ? p2() : S2(e4._view, false), c(void 0);
      }
      __name(g2, "g");
      function v3() {
        if (s2) return d2 = true, c(void 0);
        s2 = true;
        const e4 = Ke(n2._readableStreamController);
        return null === e4 ? p2() : S2(e4._view, true), c(void 0);
      }
      __name(v3, "v");
      function w3(o3) {
        if (f2 = true, t3 = o3, h2) {
          const o4 = le([t3, r2]), n3 = Mr(e3, o4);
          i2(n3);
        }
        return b3;
      }
      __name(w3, "w");
      function R3(o3) {
        if (h2 = true, r2 = o3, f2) {
          const o4 = le([t3, r2]), n3 = Mr(e3, o4);
          i2(n3);
        }
        return b3;
      }
      __name(R3, "R");
      function T3() {
      }
      __name(T3, "T");
      return o2 = Fr(T3, g2, w3), n2 = Fr(T3, v3, R3), m2(a3), [o2, n2];
    })(e2) : (function(e3) {
      const t3 = V(e3);
      let r2, o2, n2, i2, a3, s2 = false, l2 = false, d2 = false, f2 = false;
      const h2 = u((e4) => {
        a3 = e4;
      });
      function b3() {
        if (s2) return l2 = true, c(void 0);
        s2 = true;
        return te(t3, { _chunkSteps: /* @__PURE__ */ __name((e4) => {
          y(() => {
            l2 = false;
            const t4 = e4, r3 = e4;
            d2 || Rr(n2._readableStreamController, t4), f2 || Rr(i2._readableStreamController, r3), s2 = false, l2 && b3();
          });
        }, "_chunkSteps"), _closeSteps: /* @__PURE__ */ __name(() => {
          s2 = false, d2 || wr(n2._readableStreamController), f2 || wr(i2._readableStreamController), d2 && f2 || a3(void 0);
        }, "_closeSteps"), _errorSteps: /* @__PURE__ */ __name(() => {
          s2 = false;
        }, "_errorSteps") }), c(void 0);
      }
      __name(b3, "b");
      function m2(t4) {
        if (d2 = true, r2 = t4, f2) {
          const t5 = le([r2, o2]), n3 = Mr(e3, t5);
          a3(n3);
        }
        return h2;
      }
      __name(m2, "m");
      function p2(t4) {
        if (f2 = true, o2 = t4, d2) {
          const t5 = le([r2, o2]), n3 = Mr(e3, t5);
          a3(n3);
        }
        return h2;
      }
      __name(p2, "p");
      function S2() {
      }
      __name(S2, "S");
      return n2 = Dr(S2, b3, m2), i2 = Dr(S2, b3, p2), _(t3._closedPromise, (e4) => (Tr(n2._readableStreamController, e4), Tr(i2._readableStreamController, e4), d2 && f2 || a3(void 0), null)), [n2, i2];
    })(e2);
  }
  __name(Wr, "Wr");
  function Or(r2) {
    return t(o2 = r2) && void 0 !== o2.getReader ? (function(r3) {
      let o3;
      function n2() {
        let e2;
        try {
          e2 = r3.read();
        } catch (e3) {
          return d(e3);
        }
        return m(e2, (e3) => {
          if (!t(e3)) throw new TypeError("The promise returned by the reader.read() method must fulfill with an object");
          if (e3.done) wr(o3._readableStreamController);
          else {
            const t2 = e3.value;
            Rr(o3._readableStreamController, t2);
          }
        });
      }
      __name(n2, "n");
      function i2(e2) {
        try {
          return c(r3.cancel(e2));
        } catch (e3) {
          return d(e3);
        }
      }
      __name(i2, "i");
      return o3 = Dr(e, n2, i2, 0), o3;
    })(r2.getReader()) : (function(r3) {
      let o3;
      const n2 = me(r3, "async");
      function i2() {
        let e2;
        try {
          e2 = pe(n2);
        } catch (e3) {
          return d(e3);
        }
        return m(c(e2), (e3) => {
          if (!t(e3)) throw new TypeError("The promise returned by the iterator.next() method must fulfill with an object");
          if (e3.done) wr(o3._readableStreamController);
          else {
            const t2 = e3.value;
            Rr(o3._readableStreamController, t2);
          }
        });
      }
      __name(i2, "i");
      function a3(e2) {
        const r4 = n2.iterator;
        let o4;
        try {
          o4 = he(r4, "return");
        } catch (e3) {
          return d(e3);
        }
        if (void 0 === o4) return c(void 0);
        return m(g(o4, r4, [e2]), (e3) => {
          if (!t(e3)) throw new TypeError("The promise returned by the iterator.return() method must fulfill with an object");
        });
      }
      __name(a3, "a");
      return o3 = Dr(e, i2, a3, 0), o3;
    })(r2);
    var o2;
  }
  __name(Or, "Or");
  function Br(e2, t2, r2) {
    return I(e2, r2), (r3) => g(e2, t2, [r3]);
  }
  __name(Br, "Br");
  function jr(e2, t2, r2) {
    return I(e2, r2), (r3) => g(e2, t2, [r3]);
  }
  __name(jr, "jr");
  function kr(e2, t2, r2) {
    return I(e2, r2), (r3) => S(e2, t2, [r3]);
  }
  __name(kr, "kr");
  function Ar(e2, t2) {
    if ("bytes" !== (e2 = `${e2}`)) throw new TypeError(`${t2} '${e2}' is not a valid enumeration value for ReadableStreamType`);
    return e2;
  }
  __name(Ar, "Ar");
  function zr(e2, t2) {
    L(e2, t2);
    const r2 = null == e2 ? void 0 : e2.preventAbort, o2 = null == e2 ? void 0 : e2.preventCancel, n2 = null == e2 ? void 0 : e2.preventClose, i2 = null == e2 ? void 0 : e2.signal;
    return void 0 !== i2 && (function(e3, t3) {
      if (!(function(e4) {
        if ("object" != typeof e4 || null === e4) return false;
        try {
          return "boolean" == typeof e4.aborted;
        } catch (e5) {
          return false;
        }
      })(e3)) throw new TypeError(`${t3} is not an AbortSignal.`);
    })(i2, `${t2} has member 'signal' that`), { preventAbort: Boolean(r2), preventCancel: Boolean(o2), preventClose: Boolean(n2), signal: i2 };
  }
  __name(zr, "zr");
  Object.defineProperties(ReadableStreamDefaultController.prototype, { close: { enumerable: true }, enqueue: { enumerable: true }, error: { enumerable: true }, desiredSize: { enumerable: true } }), o(ReadableStreamDefaultController.prototype.close, "close"), o(ReadableStreamDefaultController.prototype.enqueue, "enqueue"), o(ReadableStreamDefaultController.prototype.error, "error"), "symbol" == typeof Symbol.toStringTag && Object.defineProperty(ReadableStreamDefaultController.prototype, Symbol.toStringTag, { value: "ReadableStreamDefaultController", configurable: true });
  var ReadableStream = class {
    static {
      __name(this, "ReadableStream");
    }
    constructor(e2 = {}, t2 = {}) {
      void 0 === e2 ? e2 = null : $(e2, "First parameter");
      const r2 = yt(t2, "Second parameter"), o2 = (function(e3, t3) {
        L(e3, t3);
        const r3 = e3, o3 = null == r3 ? void 0 : r3.autoAllocateChunkSize, n2 = null == r3 ? void 0 : r3.cancel, i2 = null == r3 ? void 0 : r3.pull, a3 = null == r3 ? void 0 : r3.start, s2 = null == r3 ? void 0 : r3.type;
        return { autoAllocateChunkSize: void 0 === o3 ? void 0 : N(o3, `${t3} has member 'autoAllocateChunkSize' that`), cancel: void 0 === n2 ? void 0 : Br(n2, r3, `${t3} has member 'cancel' that`), pull: void 0 === i2 ? void 0 : jr(i2, r3, `${t3} has member 'pull' that`), start: void 0 === a3 ? void 0 : kr(a3, r3, `${t3} has member 'start' that`), type: void 0 === s2 ? void 0 : Ar(s2, `${t3} has member 'type' that`) };
      })(e2, "First parameter");
      if (Lr(this), "bytes" === o2.type) {
        if (void 0 !== r2.size) throw new RangeError("The strategy for a byte stream cannot have a size function");
        !(function(e3, t3, r3) {
          const o3 = Object.create(ReadableByteStreamController.prototype);
          let n2, i2, a3;
          n2 = void 0 !== t3.start ? () => t3.start(o3) : () => {
          }, i2 = void 0 !== t3.pull ? () => t3.pull(o3) : () => c(void 0), a3 = void 0 !== t3.cancel ? (e4) => t3.cancel(e4) : () => c(void 0);
          const s2 = t3.autoAllocateChunkSize;
          if (0 === s2) throw new TypeError("autoAllocateChunkSize must be greater than 0");
          rt(e3, o3, n2, i2, a3, r3, s2);
        })(this, o2, mt(r2, 0));
      } else {
        const e3 = pt(r2);
        !(function(e4, t3, r3, o3) {
          const n2 = Object.create(ReadableStreamDefaultController.prototype);
          let i2, a3, s2;
          i2 = void 0 !== t3.start ? () => t3.start(n2) : () => {
          }, a3 = void 0 !== t3.pull ? () => t3.pull(n2) : () => c(void 0), s2 = void 0 !== t3.cancel ? (e5) => t3.cancel(e5) : () => c(void 0), qr(e4, n2, i2, a3, s2, r3, o3);
        })(this, o2, mt(r2, 1), e3);
      }
    }
    get locked() {
      if (!Ir(this)) throw Qr("locked");
      return $r(this);
    }
    cancel(e2 = void 0) {
      return Ir(this) ? $r(this) ? d(new TypeError("Cannot cancel a stream that already has a reader")) : Mr(this, e2) : d(Qr("cancel"));
    }
    getReader(e2 = void 0) {
      if (!Ir(this)) throw Qr("getReader");
      return void 0 === (function(e3, t2) {
        L(e3, t2);
        const r2 = null == e3 ? void 0 : e3.mode;
        return { mode: void 0 === r2 ? void 0 : it(r2, `${t2} has member 'mode' that`) };
      })(e2, "First parameter").mode ? V(this) : at(this);
    }
    pipeThrough(e2, t2 = {}) {
      if (!Ir(this)) throw Qr("pipeThrough");
      M(e2, 1, "pipeThrough");
      const r2 = (function(e3, t3) {
        L(e3, t3);
        const r3 = null == e3 ? void 0 : e3.readable;
        Y(r3, "readable", "ReadableWritablePair"), H(r3, `${t3} has member 'readable' that`);
        const o3 = null == e3 ? void 0 : e3.writable;
        return Y(o3, "writable", "ReadableWritablePair"), Tt(o3, `${t3} has member 'writable' that`), { readable: r3, writable: o3 };
      })(e2, "First parameter"), o2 = zr(t2, "Second parameter");
      if ($r(this)) throw new TypeError("ReadableStream.prototype.pipeThrough cannot be used on a locked ReadableStream");
      if (Et(r2.writable)) throw new TypeError("ReadableStream.prototype.pipeThrough cannot be used on a locked WritableStream");
      return p(hr(this, r2.writable, o2.preventClose, o2.preventAbort, o2.preventCancel, o2.signal)), r2.readable;
    }
    pipeTo(e2, t2 = {}) {
      if (!Ir(this)) return d(Qr("pipeTo"));
      if (void 0 === e2) return d("Parameter 1 is required in 'pipeTo'.");
      if (!qt(e2)) return d(new TypeError("ReadableStream.prototype.pipeTo's first argument must be a WritableStream"));
      let r2;
      try {
        r2 = zr(t2, "Second parameter");
      } catch (e3) {
        return d(e3);
      }
      return $r(this) ? d(new TypeError("ReadableStream.prototype.pipeTo cannot be used on a locked ReadableStream")) : Et(e2) ? d(new TypeError("ReadableStream.prototype.pipeTo cannot be used on a locked WritableStream")) : hr(this, e2, r2.preventClose, r2.preventAbort, r2.preventCancel, r2.signal);
    }
    tee() {
      if (!Ir(this)) throw Qr("tee");
      return le(Wr(this));
    }
    values(e2 = void 0) {
      if (!Ir(this)) throw Qr("values");
      return (function(e3, t2) {
        const r2 = V(e3), o2 = new ye(r2, t2), n2 = Object.create(ge);
        return n2._asyncIteratorImpl = o2, n2;
      })(this, (function(e3, t2) {
        L(e3, t2);
        const r2 = null == e3 ? void 0 : e3.preventCancel;
        return { preventCancel: Boolean(r2) };
      })(e2, "First parameter").preventCancel);
    }
    [_e](e2) {
      return this.values(e2);
    }
    static from(e2) {
      return Or(e2);
    }
  };
  function Dr(e2, t2, r2, o2 = 1, n2 = () => 1) {
    const i2 = Object.create(ReadableStream.prototype);
    Lr(i2);
    return qr(i2, Object.create(ReadableStreamDefaultController.prototype), e2, t2, r2, o2, n2), i2;
  }
  __name(Dr, "Dr");
  function Fr(e2, t2, r2) {
    const o2 = Object.create(ReadableStream.prototype);
    Lr(o2);
    return rt(o2, Object.create(ReadableByteStreamController.prototype), e2, t2, r2, 0, void 0), o2;
  }
  __name(Fr, "Fr");
  function Lr(e2) {
    e2._state = "readable", e2._reader = void 0, e2._storedError = void 0, e2._disturbed = false;
  }
  __name(Lr, "Lr");
  function Ir(e2) {
    return !!t(e2) && (!!Object.prototype.hasOwnProperty.call(e2, "_readableStreamController") && e2 instanceof ReadableStream);
  }
  __name(Ir, "Ir");
  function $r(e2) {
    return void 0 !== e2._reader;
  }
  __name($r, "$r");
  function Mr(t2, r2) {
    if (t2._disturbed = true, "closed" === t2._state) return c(void 0);
    if ("errored" === t2._state) return d(t2._storedError);
    Yr(t2);
    const o2 = t2._reader;
    if (void 0 !== o2 && ft(o2)) {
      const e2 = o2._readIntoRequests;
      o2._readIntoRequests = new v(), e2.forEach((e3) => {
        e3._closeSteps(void 0);
      });
    }
    return m(t2._readableStreamController[T](r2), e);
  }
  __name(Mr, "Mr");
  function Yr(e2) {
    e2._state = "closed";
    const t2 = e2._reader;
    if (void 0 !== t2 && (z(t2), ee(t2))) {
      const e3 = t2._readRequests;
      t2._readRequests = new v(), e3.forEach((e4) => {
        e4._closeSteps();
      });
    }
  }
  __name(Yr, "Yr");
  function xr(e2, t2) {
    e2._state = "errored", e2._storedError = t2;
    const r2 = e2._reader;
    void 0 !== r2 && (A(r2, t2), ee(r2) ? oe(r2, t2) : bt(r2, t2));
  }
  __name(xr, "xr");
  function Qr(e2) {
    return new TypeError(`ReadableStream.prototype.${e2} can only be used on a ReadableStream`);
  }
  __name(Qr, "Qr");
  function Nr(e2, t2) {
    L(e2, t2);
    const r2 = null == e2 ? void 0 : e2.highWaterMark;
    return Y(r2, "highWaterMark", "QueuingStrategyInit"), { highWaterMark: x(r2) };
  }
  __name(Nr, "Nr");
  Object.defineProperties(ReadableStream, { from: { enumerable: true } }), Object.defineProperties(ReadableStream.prototype, { cancel: { enumerable: true }, getReader: { enumerable: true }, pipeThrough: { enumerable: true }, pipeTo: { enumerable: true }, tee: { enumerable: true }, values: { enumerable: true }, locked: { enumerable: true } }), o(ReadableStream.from, "from"), o(ReadableStream.prototype.cancel, "cancel"), o(ReadableStream.prototype.getReader, "getReader"), o(ReadableStream.prototype.pipeThrough, "pipeThrough"), o(ReadableStream.prototype.pipeTo, "pipeTo"), o(ReadableStream.prototype.tee, "tee"), o(ReadableStream.prototype.values, "values"), "symbol" == typeof Symbol.toStringTag && Object.defineProperty(ReadableStream.prototype, Symbol.toStringTag, { value: "ReadableStream", configurable: true }), Object.defineProperty(ReadableStream.prototype, _e, { value: ReadableStream.prototype.values, writable: true, configurable: true });
  var Hr = /* @__PURE__ */ __name((e2) => e2.byteLength, "Hr");
  o(Hr, "size");
  var ByteLengthQueuingStrategy = class {
    static {
      __name(this, "ByteLengthQueuingStrategy");
    }
    constructor(e2) {
      M(e2, 1, "ByteLengthQueuingStrategy"), e2 = Nr(e2, "First parameter"), this._byteLengthQueuingStrategyHighWaterMark = e2.highWaterMark;
    }
    get highWaterMark() {
      if (!Ur(this)) throw Vr("highWaterMark");
      return this._byteLengthQueuingStrategyHighWaterMark;
    }
    get size() {
      if (!Ur(this)) throw Vr("size");
      return Hr;
    }
  };
  function Vr(e2) {
    return new TypeError(`ByteLengthQueuingStrategy.prototype.${e2} can only be used on a ByteLengthQueuingStrategy`);
  }
  __name(Vr, "Vr");
  function Ur(e2) {
    return !!t(e2) && (!!Object.prototype.hasOwnProperty.call(e2, "_byteLengthQueuingStrategyHighWaterMark") && e2 instanceof ByteLengthQueuingStrategy);
  }
  __name(Ur, "Ur");
  Object.defineProperties(ByteLengthQueuingStrategy.prototype, { highWaterMark: { enumerable: true }, size: { enumerable: true } }), "symbol" == typeof Symbol.toStringTag && Object.defineProperty(ByteLengthQueuingStrategy.prototype, Symbol.toStringTag, { value: "ByteLengthQueuingStrategy", configurable: true });
  var Gr = /* @__PURE__ */ __name(() => 1, "Gr");
  o(Gr, "size");
  var CountQueuingStrategy = class {
    static {
      __name(this, "CountQueuingStrategy");
    }
    constructor(e2) {
      M(e2, 1, "CountQueuingStrategy"), e2 = Nr(e2, "First parameter"), this._countQueuingStrategyHighWaterMark = e2.highWaterMark;
    }
    get highWaterMark() {
      if (!Jr(this)) throw Xr("highWaterMark");
      return this._countQueuingStrategyHighWaterMark;
    }
    get size() {
      if (!Jr(this)) throw Xr("size");
      return Gr;
    }
  };
  function Xr(e2) {
    return new TypeError(`CountQueuingStrategy.prototype.${e2} can only be used on a CountQueuingStrategy`);
  }
  __name(Xr, "Xr");
  function Jr(e2) {
    return !!t(e2) && (!!Object.prototype.hasOwnProperty.call(e2, "_countQueuingStrategyHighWaterMark") && e2 instanceof CountQueuingStrategy);
  }
  __name(Jr, "Jr");
  function Kr(e2, t2, r2) {
    return I(e2, r2), (r3) => g(e2, t2, [r3]);
  }
  __name(Kr, "Kr");
  function Zr(e2, t2, r2) {
    return I(e2, r2), (r3) => S(e2, t2, [r3]);
  }
  __name(Zr, "Zr");
  function eo(e2, t2, r2) {
    return I(e2, r2), (r3, o2) => g(e2, t2, [r3, o2]);
  }
  __name(eo, "eo");
  function to(e2, t2, r2) {
    return I(e2, r2), (r3) => g(e2, t2, [r3]);
  }
  __name(to, "to");
  Object.defineProperties(CountQueuingStrategy.prototype, { highWaterMark: { enumerable: true }, size: { enumerable: true } }), "symbol" == typeof Symbol.toStringTag && Object.defineProperty(CountQueuingStrategy.prototype, Symbol.toStringTag, { value: "CountQueuingStrategy", configurable: true });
  var TransformStream = class {
    static {
      __name(this, "TransformStream");
    }
    constructor(e2 = {}, t2 = {}, r2 = {}) {
      void 0 === e2 && (e2 = null);
      const o2 = yt(t2, "Second parameter"), n2 = yt(r2, "Third parameter"), i2 = (function(e3, t3) {
        L(e3, t3);
        const r3 = null == e3 ? void 0 : e3.cancel, o3 = null == e3 ? void 0 : e3.flush, n3 = null == e3 ? void 0 : e3.readableType, i3 = null == e3 ? void 0 : e3.start, a4 = null == e3 ? void 0 : e3.transform, s3 = null == e3 ? void 0 : e3.writableType;
        return { cancel: void 0 === r3 ? void 0 : to(r3, e3, `${t3} has member 'cancel' that`), flush: void 0 === o3 ? void 0 : Kr(o3, e3, `${t3} has member 'flush' that`), readableType: n3, start: void 0 === i3 ? void 0 : Zr(i3, e3, `${t3} has member 'start' that`), transform: void 0 === a4 ? void 0 : eo(a4, e3, `${t3} has member 'transform' that`), writableType: s3 };
      })(e2, "First parameter");
      if (void 0 !== i2.readableType) throw new RangeError("Invalid readableType specified");
      if (void 0 !== i2.writableType) throw new RangeError("Invalid writableType specified");
      const a3 = mt(n2, 0), s2 = pt(n2), l2 = mt(o2, 1), f2 = pt(o2);
      let b3;
      !(function(e3, t3, r3, o3, n3, i3) {
        function a4() {
          return t3;
        }
        __name(a4, "a");
        function s3(t4) {
          return (function(e4, t5) {
            const r4 = e4._transformStreamController;
            if (e4._backpressure) {
              return m(e4._backpressureChangePromise, () => {
                const o4 = e4._writable;
                if ("erroring" === o4._state) throw o4._storedError;
                return co(r4, t5);
              });
            }
            return co(r4, t5);
          })(e3, t4);
        }
        __name(s3, "s");
        function l3(t4) {
          return (function(e4, t5) {
            const r4 = e4._transformStreamController;
            if (void 0 !== r4._finishPromise) return r4._finishPromise;
            const o4 = e4._readable;
            r4._finishPromise = u((e5, t6) => {
              r4._finishPromise_resolve = e5, r4._finishPromise_reject = t6;
            });
            const n4 = r4._cancelAlgorithm(t5);
            return lo(r4), h(n4, () => ("errored" === o4._state ? bo(r4, o4._storedError) : (Tr(o4._readableStreamController, t5), ho(r4)), null), (e5) => (Tr(o4._readableStreamController, e5), bo(r4, e5), null)), r4._finishPromise;
          })(e3, t4);
        }
        __name(l3, "l");
        function c2() {
          return (function(e4) {
            const t4 = e4._transformStreamController;
            if (void 0 !== t4._finishPromise) return t4._finishPromise;
            const r4 = e4._readable;
            t4._finishPromise = u((e5, r5) => {
              t4._finishPromise_resolve = e5, t4._finishPromise_reject = r5;
            });
            const o4 = t4._flushAlgorithm();
            return lo(t4), h(o4, () => ("errored" === r4._state ? bo(t4, r4._storedError) : (wr(r4._readableStreamController), ho(t4)), null), (e5) => (Tr(r4._readableStreamController, e5), bo(t4, e5), null)), t4._finishPromise;
          })(e3);
        }
        __name(c2, "c");
        function d2() {
          return (function(e4) {
            return ao(e4, false), e4._backpressureChangePromise;
          })(e3);
        }
        __name(d2, "d");
        function f3(t4) {
          return (function(e4, t5) {
            const r4 = e4._transformStreamController;
            if (void 0 !== r4._finishPromise) return r4._finishPromise;
            const o4 = e4._writable;
            r4._finishPromise = u((e5, t6) => {
              r4._finishPromise_resolve = e5, r4._finishPromise_reject = t6;
            });
            const n4 = r4._cancelAlgorithm(t5);
            return lo(r4), h(n4, () => ("errored" === o4._state ? bo(r4, o4._storedError) : (Gt(o4._writableStreamController, t5), io(e4), ho(r4)), null), (t6) => (Gt(o4._writableStreamController, t6), io(e4), bo(r4, t6), null)), r4._finishPromise;
          })(e3, t4);
        }
        __name(f3, "f");
        e3._writable = (function(e4, t4, r4, o4, n4 = 1, i4 = () => 1) {
          const a5 = Object.create(WritableStream.prototype);
          return Ct(a5), Nt(a5, Object.create(WritableStreamDefaultController.prototype), e4, t4, r4, o4, n4, i4), a5;
        })(a4, s3, c2, l3, r3, o3), e3._readable = Dr(a4, d2, f3, n3, i3), e3._backpressure = void 0, e3._backpressureChangePromise = void 0, e3._backpressureChangePromise_resolve = void 0, ao(e3, true), e3._transformStreamController = void 0;
      })(this, u((e3) => {
        b3 = e3;
      }), l2, f2, a3, s2), (function(e3, t3) {
        const r3 = Object.create(TransformStreamDefaultController.prototype);
        let o3, n3, i3;
        o3 = void 0 !== t3.transform ? (e4) => t3.transform(e4, r3) : (e4) => {
          try {
            return uo(r3, e4), c(void 0);
          } catch (e5) {
            return d(e5);
          }
        };
        n3 = void 0 !== t3.flush ? () => t3.flush(r3) : () => c(void 0);
        i3 = void 0 !== t3.cancel ? (e4) => t3.cancel(e4) : () => c(void 0);
        !(function(e4, t4, r4, o4, n4) {
          t4._controlledTransformStream = e4, e4._transformStreamController = t4, t4._transformAlgorithm = r4, t4._flushAlgorithm = o4, t4._cancelAlgorithm = n4, t4._finishPromise = void 0, t4._finishPromise_resolve = void 0, t4._finishPromise_reject = void 0;
        })(e3, r3, o3, n3, i3);
      })(this, i2), void 0 !== i2.start ? b3(i2.start(this._transformStreamController)) : b3(void 0);
    }
    get readable() {
      if (!ro(this)) throw _o("readable");
      return this._readable;
    }
    get writable() {
      if (!ro(this)) throw _o("writable");
      return this._writable;
    }
  };
  function ro(e2) {
    return !!t(e2) && (!!Object.prototype.hasOwnProperty.call(e2, "_transformStreamController") && e2 instanceof TransformStream);
  }
  __name(ro, "ro");
  function oo(e2, t2) {
    Tr(e2._readable._readableStreamController, t2), no(e2, t2);
  }
  __name(oo, "oo");
  function no(e2, t2) {
    lo(e2._transformStreamController), Gt(e2._writable._writableStreamController, t2), io(e2);
  }
  __name(no, "no");
  function io(e2) {
    e2._backpressure && ao(e2, false);
  }
  __name(io, "io");
  function ao(e2, t2) {
    void 0 !== e2._backpressureChangePromise && e2._backpressureChangePromise_resolve(), e2._backpressureChangePromise = u((t3) => {
      e2._backpressureChangePromise_resolve = t3;
    }), e2._backpressure = t2;
  }
  __name(ao, "ao");
  Object.defineProperties(TransformStream.prototype, { readable: { enumerable: true }, writable: { enumerable: true } }), "symbol" == typeof Symbol.toStringTag && Object.defineProperty(TransformStream.prototype, Symbol.toStringTag, { value: "TransformStream", configurable: true });
  var TransformStreamDefaultController = class {
    static {
      __name(this, "TransformStreamDefaultController");
    }
    constructor() {
      throw new TypeError("Illegal constructor");
    }
    get desiredSize() {
      if (!so(this)) throw fo("desiredSize");
      return Pr(this._controlledTransformStream._readable._readableStreamController);
    }
    enqueue(e2 = void 0) {
      if (!so(this)) throw fo("enqueue");
      uo(this, e2);
    }
    error(e2 = void 0) {
      if (!so(this)) throw fo("error");
      var t2;
      t2 = e2, oo(this._controlledTransformStream, t2);
    }
    terminate() {
      if (!so(this)) throw fo("terminate");
      !(function(e2) {
        const t2 = e2._controlledTransformStream;
        wr(t2._readable._readableStreamController);
        const r2 = new TypeError("TransformStream terminated");
        no(t2, r2);
      })(this);
    }
  };
  function so(e2) {
    return !!t(e2) && (!!Object.prototype.hasOwnProperty.call(e2, "_controlledTransformStream") && e2 instanceof TransformStreamDefaultController);
  }
  __name(so, "so");
  function lo(e2) {
    e2._transformAlgorithm = void 0, e2._flushAlgorithm = void 0, e2._cancelAlgorithm = void 0;
  }
  __name(lo, "lo");
  function uo(e2, t2) {
    const r2 = e2._controlledTransformStream, o2 = r2._readable._readableStreamController;
    if (!Cr(o2)) throw new TypeError("Readable side is not in a state that permits enqueue");
    try {
      Rr(o2, t2);
    } catch (e3) {
      throw no(r2, e3), r2._readable._storedError;
    }
    const n2 = (function(e3) {
      return !gr(e3);
    })(o2);
    n2 !== r2._backpressure && ao(r2, true);
  }
  __name(uo, "uo");
  function co(e2, t2) {
    return m(e2._transformAlgorithm(t2), void 0, (t3) => {
      throw oo(e2._controlledTransformStream, t3), t3;
    });
  }
  __name(co, "co");
  function fo(e2) {
    return new TypeError(`TransformStreamDefaultController.prototype.${e2} can only be used on a TransformStreamDefaultController`);
  }
  __name(fo, "fo");
  function ho(e2) {
    void 0 !== e2._finishPromise_resolve && (e2._finishPromise_resolve(), e2._finishPromise_resolve = void 0, e2._finishPromise_reject = void 0);
  }
  __name(ho, "ho");
  function bo(e2, t2) {
    void 0 !== e2._finishPromise_reject && (p(e2._finishPromise), e2._finishPromise_reject(t2), e2._finishPromise_resolve = void 0, e2._finishPromise_reject = void 0);
  }
  __name(bo, "bo");
  function _o(e2) {
    return new TypeError(`TransformStream.prototype.${e2} can only be used on a TransformStream`);
  }
  __name(_o, "_o");
  Object.defineProperties(TransformStreamDefaultController.prototype, { enqueue: { enumerable: true }, error: { enumerable: true }, terminate: { enumerable: true }, desiredSize: { enumerable: true } }), o(TransformStreamDefaultController.prototype.enqueue, "enqueue"), o(TransformStreamDefaultController.prototype.error, "error"), o(TransformStreamDefaultController.prototype.terminate, "terminate"), "symbol" == typeof Symbol.toStringTag && Object.defineProperty(TransformStreamDefaultController.prototype, Symbol.toStringTag, { value: "TransformStreamDefaultController", configurable: true });

  // src/blob.js
  var bytesByBlob = /* @__PURE__ */ new WeakMap();
  var readBytes = /* @__PURE__ */ Symbol("readBytes");
  var Blob = class _Blob {
    static {
      __name(this, "Blob");
    }
    constructor(parts2 = [], { type = "" } = {}) {
      bytesByBlob.set(this, { bytes: getPartBytes(parts2), type: getType(type) });
    }
    get size() {
      return getBytes(this).length;
    }
    get type() {
      return bytesByBlob.get(this).type;
    }
    slice(start = 0, end, type = "") {
      const bytes = getBytes(this);
      return new _Blob([bytes.slice(start, end ?? bytes.length)], { type });
    }
    async text() {
      return new TextDecoder().decode(getBytes(this));
    }
    async arrayBuffer() {
      return getBytes(this).slice().buffer;
    }
    async bytes() {
      return getBytes(this).slice();
    }
    stream() {
      const blob = this;
      return new ReadableStream({
        type: "bytes",
        pull(controller) {
          const bytes = getBytes(blob);
          if (bytes.length) controller.enqueue(bytes.slice());
          controller.close();
        }
      });
    }
  };
  var File = class extends Blob {
    static {
      __name(this, "File");
    }
    #name;
    #lastModified;
    constructor(parts2, name, options = {}) {
      checkArguments(arguments, 2, "File");
      super(parts2, options);
      this.#name = String(name);
      this.#lastModified = Math.trunc(Number(options.lastModified ?? Date.now()));
    }
    get name() {
      return this.#name;
    }
    get lastModified() {
      return this.#lastModified;
    }
    get webkitRelativePath() {
      return "";
    }
  };
  setToStringTag(Blob, File);
  function getBytes(blob) {
    return blob[readBytes]?.() ?? bytesByBlob.get(blob).bytes;
  }
  __name(getBytes, "getBytes");
  function getBufferBytes(value) {
    return value instanceof ArrayBuffer ? new Uint8Array(value) : ArrayBuffer.isView(value) ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength) : null;
  }
  __name(getBufferBytes, "getBufferBytes");
  function getPartBytes(parts2) {
    const encoder = new TextEncoder();
    const list = Array.from(
      parts2,
      (part) => getBufferBytes(part) ?? (part instanceof Blob ? getBytes(part) : encoder.encode(String(part)))
    );
    const bytes = new Uint8Array(
      list.reduce((size, part) => size + part.length, 0)
    );
    let offset = 0;
    for (const part of list) {
      bytes.set(part, offset);
      offset += part.length;
    }
    return bytes;
  }
  __name(getPartBytes, "getPartBytes");
  function getType(type) {
    type = String(type);
    return /^[\x20-\x7e]*$/.test(type) ? type.toLowerCase() : "";
  }
  __name(getType, "getType");

  // src/broadcast-channel.js
  var BroadcastChannel = class extends EventTarget {
    static {
      __name(this, "BroadcastChannel");
    }
    #name;
    // `null` once the channel is closed:
    #number;
    constructor(name) {
      checkArguments(arguments, 1, "BroadcastChannel");
      super();
      this.#name = String(name);
      this.#number = natives.broadcast.open(
        this.#name,
        ({ type, data }) => fire(this, new MessageEvent(type, { data }))
      );
    }
    get name() {
      return this.#name;
    }
    postMessage(message) {
      checkArguments(arguments, 1, "postMessage");
      if (this.#number === null) {
        throw new DOMException(
          "Unable to post to a BroadcastChannel that is closed.",
          "InvalidStateError"
        );
      }
      natives.broadcast.post(this.#number, message);
    }
    close() {
      if (this.#number !== null) {
        natives.broadcast.close(this.#number);
        this.#number = null;
      }
    }
  };
  defineEventHandlers(BroadcastChannel.prototype, "message", "messageerror");
  setToStringTag(BroadcastChannel);

  // src/canvas.js
  var canvas_exports = {};
  __export(canvas_exports, {
    CanvasGradient: () => CanvasGradient,
    CanvasPattern: () => CanvasPattern,
    ImageBitmap: () => ImageBitmap,
    ImageData: () => ImageData,
    OffscreenCanvas: () => OffscreenCanvas,
    OffscreenCanvasRenderingContext2D: () => OffscreenCanvasRenderingContext2D,
    Path2D: () => Path2D,
    TextCluster: () => TextCluster,
    TextMetrics: () => TextMetrics,
    createImageBitmap: () => createImageBitmap
  });

  // src/geometry.js
  var geometry_exports = {};
  __export(geometry_exports, {
    DOMMatrix: () => DOMMatrix2,
    DOMMatrixReadOnly: () => DOMMatrixReadOnly,
    DOMPoint: () => DOMPoint,
    DOMPointReadOnly: () => DOMPointReadOnly,
    DOMQuad: () => DOMQuad,
    DOMRect: () => DOMRect,
    DOMRectReadOnly: () => DOMRectReadOnly,
    getGeometryValues: () => getGeometryValues
  });

  // src/css-transform.js
  var functions = {
    matrix: Array(6).fill("number"),
    matrix3d: Array(16).fill("number"),
    translate: ["length", "length?"],
    translatex: ["length"],
    translatey: ["length"],
    translatez: ["length"],
    translate3d: ["length", "length", "length"],
    scale: ["scale", "scale?"],
    scalex: ["scale"],
    scaley: ["scale"],
    scalez: ["scale"],
    scale3d: ["scale", "scale", "scale"],
    rotate: ["angle"],
    rotatex: ["angle"],
    rotatey: ["angle"],
    rotatez: ["angle"],
    rotate3d: ["number", "number", "number", "angle"],
    skew: ["angle", "angle?"],
    skewx: ["angle"],
    skewy: ["angle"],
    perspective: ["length"]
  };
  var units = {
    "": ["number", 1],
    "%": ["percentage", 1],
    "px": ["length", 1],
    "cm": ["length", 96 / 2.54],
    "mm": ["length", 96 / 25.4],
    "q": ["length", 96 / 101.6],
    "in": ["length", 96],
    "pc": ["length", 16],
    "pt": ["length", 4 / 3],
    "deg": ["angle", 1],
    "rad": ["angle", 180 / Math.PI],
    "grad": ["angle", 0.9],
    "turn": ["angle", 360]
  };
  function parseTransformList(text) {
    let rest = String(text).replace(/\/\*[^]*?\*\//g, "").trim();
    if (/^none$/i.test(rest)) return [];
    const list = [];
    do {
      const match = /^([a-z0-9]+)\(/i.exec(rest);
      const name = match?.[1].toLowerCase();
      const types2 = functions[name];
      if (!types2) throw syntaxError(text);
      const end = getClosing(rest, match[0].length, text);
      const args = split(rest.slice(match[0].length, end)).map(
        (arg) => parseValue(arg, text)
      );
      list.push({ name, args: getArguments(args, types2, text) });
      rest = rest.slice(end + 1).trimStart();
    } while (rest);
    return list;
  }
  __name(parseTransformList, "parseTransformList");
  function getArguments(args, types2, text) {
    const needed = types2.filter((type) => !type.endsWith("?")).length;
    if (args.length < needed || args.length > types2.length) {
      throw syntaxError(text);
    }
    return args.map(({ type, value }, index) => {
      const wanted = types2[index].replace("?", "");
      if (type === wanted || // A length or an angle may be a plain 0:
      type === "number" && value === 0 && wanted !== "number") {
        return value;
      } else if (wanted === "scale" && (type === "number" || type === "percentage")) {
        return type === "percentage" ? value / 100 : value;
      } else {
        throw syntaxError(text);
      }
    });
  }
  __name(getArguments, "getArguments");
  function parseValue(source, text) {
    const tokens = tokenize(source.trim(), text);
    let at2 = 0;
    const peek = /* @__PURE__ */ __name(() => tokens[at2], "peek");
    const next = /* @__PURE__ */ __name(() => tokens[at2++], "next");
    const sum = /* @__PURE__ */ __name(() => {
      let left = product();
      while (peek() === "+" || peek() === "-") {
        const sign = next() === "+" ? 1 : -1;
        const right = product();
        if (left.type !== right.type) throw syntaxError(text);
        left = { type: left.type, value: left.value + sign * right.value };
      }
      return left;
    }, "sum");
    const product = /* @__PURE__ */ __name(() => {
      let left = term();
      while (peek() === "*" || peek() === "/") {
        const operator = next();
        const right = term();
        if (operator === "*" && left.type === "number") {
          left = { type: right.type, value: left.value * right.value };
        } else if (right.type === "number") {
          left = {
            type: left.type,
            value: operator === "*" ? left.value * right.value : left.value / right.value
          };
        } else {
          throw syntaxError(text);
        }
      }
      return left;
    }, "product");
    const term = /* @__PURE__ */ __name(() => {
      const token2 = next();
      if (token2 === "(" || token2 === "calc(") {
        const value2 = sum();
        if (next() !== ")") throw syntaxError(text);
        return value2;
      } else if (token2?.type) {
        return token2;
      } else {
        throw syntaxError(text);
      }
    }, "term");
    const value = tokens[0] === "calc(" ? term() : next();
    if (!value?.type || at2 !== tokens.length) throw syntaxError(text);
    return value;
  }
  __name(parseValue, "parseValue");
  function tokenize(source, text) {
    const tokens = [];
    const pattern = /\s*(?:([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)([a-z%]*)|(calc\()|([()*/])|(\s[+-]\s))/iy;
    while (pattern.lastIndex < source.length) {
      const match = pattern.exec(source);
      if (!match) throw syntaxError(text);
      const [, number, unit, calc, symbol, operator] = match;
      if (number !== void 0) {
        const known = units[unit.toLowerCase()];
        if (!known) throw syntaxError(text);
        const [type, factor] = known;
        tokens.push({ type, value: Number(number) * factor });
      } else {
        tokens.push(calc?.toLowerCase() ?? symbol ?? operator.trim());
      }
    }
    return tokens;
  }
  __name(tokenize, "tokenize");
  function getClosing(source, start, text) {
    let depth = 1;
    for (let index = start; index < source.length; index++) {
      if (source[index] === "(") depth++;
      else if (source[index] === ")" && --depth === 0) return index;
    }
    throw syntaxError(text);
  }
  __name(getClosing, "getClosing");
  function split(source) {
    const args = [];
    let depth = 0;
    let start = 0;
    for (let index = 0; index < source.length; index++) {
      const char = source[index];
      if (char === "(") depth++;
      else if (char === ")") depth--;
      else if (char === "," && depth === 0) {
        args.push(source.slice(start, index));
        start = index + 1;
      }
    }
    args.push(source.slice(start));
    return args;
  }
  __name(split, "split");
  function syntaxError(text) {
    return new DOMException(
      `Invalid transform list: '${text}'.`,
      "SyntaxError"
    );
  }
  __name(syntaxError, "syntaxError");

  // src/geometry.js
  var identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  var aliases = [
    ["a", "m11", 0],
    ["b", "m12", 1],
    ["c", "m21", 4],
    ["d", "m22", 5],
    ["e", "m41", 12],
    ["f", "m42", 13]
  ];
  var threeD = [
    ["m13", 2, 0],
    ["m14", 3, 0],
    ["m23", 6, 0],
    ["m24", 7, 0],
    ["m31", 8, 0],
    ["m32", 9, 0],
    ["m33", 10, 1],
    ["m34", 11, 0],
    ["m43", 14, 0],
    ["m44", 15, 1]
  ];
  var names = [
    "m11",
    "m12",
    "m13",
    "m14",
    "m21",
    "m22",
    "m23",
    "m24",
    "m31",
    "m32",
    "m33",
    "m34",
    "m41",
    "m42",
    "m43",
    "m44"
  ];
  var getPoint;
  var getRect;
  var getQuad;
  var getMatrix;
  var setMatrix;
  var DOMPointReadOnly = class {
    static {
      __name(this, "DOMPointReadOnly");
    }
    #values;
    constructor(x3 = 0, y2 = 0, z3 = 0, w3 = 1) {
      this.#values = [+x3, +y2, +z3, +w3];
    }
    static {
      getPoint = /* @__PURE__ */ __name((point) => point.#values, "getPoint");
    }
    matrixTransform(matrix = {}) {
      return DOMMatrixReadOnly.fromMatrix(matrix).transformPoint(this);
    }
    toJSON() {
      const { x: x3, y: y2, z: z3, w: w3 } = this;
      return { x: x3, y: y2, z: z3, w: w3 };
    }
    static fromPoint(point) {
      const { x: x3, y: y2, z: z3, w: w3 } = getPointInit(point);
      return new this(x3, y2, z3, w3);
    }
  };
  var DOMPoint = class extends DOMPointReadOnly {
    static {
      __name(this, "DOMPoint");
    }
  };
  var DOMRectReadOnly = class {
    static {
      __name(this, "DOMRectReadOnly");
    }
    #values;
    constructor(x3 = 0, y2 = 0, width = 0, height = 0) {
      this.#values = [+x3, +y2, +width, +height];
    }
    static {
      getRect = /* @__PURE__ */ __name((rect) => rect.#values, "getRect");
    }
    // `Math.min()` and `max()` are NaN when either value is, as the sides are:
    get top() {
      return Math.min(this.y, this.y + this.height);
    }
    get right() {
      return Math.max(this.x, this.x + this.width);
    }
    get bottom() {
      return Math.max(this.y, this.y + this.height);
    }
    get left() {
      return Math.min(this.x, this.x + this.width);
    }
    toJSON() {
      const { x: x3, y: y2, width, height, top, right, bottom, left } = this;
      return { x: x3, y: y2, width, height, top, right, bottom, left };
    }
    static fromRect(rect) {
      const { x: x3, y: y2, width, height } = getRectInit(rect);
      return new this(x3, y2, width, height);
    }
  };
  var DOMRect = class extends DOMRectReadOnly {
    static {
      __name(this, "DOMRect");
    }
  };
  var DOMQuad = class {
    static {
      __name(this, "DOMQuad");
    }
    #points;
    constructor(p1, p2, p3, p4) {
      this.#points = [p1, p2, p3, p4].map((point) => DOMPoint.fromPoint(point));
    }
    static {
      getQuad = /* @__PURE__ */ __name((quad) => quad.#points, "getQuad");
    }
    get p1() {
      return this.#points[0];
    }
    get p2() {
      return this.#points[1];
    }
    get p3() {
      return this.#points[2];
    }
    get p4() {
      return this.#points[3];
    }
    getBounds() {
      const xs = this.#points.map((point) => point.x);
      const ys = this.#points.map((point) => point.y);
      const left = Math.min(...xs);
      const top = Math.min(...ys);
      return new DOMRect(left, top, Math.max(...xs) - left, Math.max(...ys) - top);
    }
    toJSON() {
      const { p1, p2, p3, p4 } = this;
      return { p1, p2, p3, p4 };
    }
    static fromRect(rect) {
      const { x: x3, y: y2, width, height } = getRectInit(rect);
      return new this(
        { x: x3, y: y2 },
        { x: x3 + width, y: y2 },
        { x: x3 + width, y: y2 + height },
        { x: x3, y: y2 + height }
      );
    }
    static fromQuad(quad) {
      const { p1, p2, p3, p4 } = getDictionary(quad, "DOMQuadInit") ?? {};
      return new this(p1, p2, p3, p4);
    }
  };
  var DOMMatrixReadOnly = class {
    static {
      __name(this, "DOMMatrixReadOnly");
    }
    #m;
    #is2D;
    // From a list of 6 numbers (2D) or 16, or else, as WebIDL converts it, from
    // text: CSS's transform functions (another matrix as it writes itself).
    constructor(init) {
      if (init === void 0) {
        this.#m = [...identity];
        this.#is2D = true;
      } else if (typeof init?.[Symbol.iterator] === "function" && typeof init !== "string") {
        ;
        [this.#m, this.#is2D] = getMatrixFromList(init);
      } else {
        ;
        [this.#m, this.#is2D] = getMatrixFromCSS(String(init));
      }
    }
    static {
      getMatrix = /* @__PURE__ */ __name((matrix) => [matrix.#m, matrix.#is2D], "getMatrix");
      setMatrix = /* @__PURE__ */ __name((matrix, [m2, is2D]) => {
        matrix.#m = m2;
        matrix.#is2D = is2D;
        return matrix;
      }, "setMatrix");
    }
    get is2D() {
      return this.#is2D;
    }
    get isIdentity() {
      return this.#m.every((value, index) => value === identity[index]);
    }
    // The operations on the read-only class give a new matrix, the writable
    // class's change it (`translateSelf()`):
    translate(tx = 0, ty = 0, tz = 0) {
      return operate(this, translation(+tx, +ty, +tz));
    }
    scale(sx = 1, sy = sx, sz = 1, ox = 0, oy = 0, oz = 0) {
      return operate(this, scalingAround(+sx, +sy, +sz, +ox, +oy, +oz));
    }
    scaleNonUniform(sx = 1, sy = 1) {
      return operate(this, scaling(+sx, +sy, 1));
    }
    scale3d(scale = 1, ox = 0, oy = 0, oz = 0) {
      return operate(this, scalingAround(+scale, +scale, +scale, +ox, +oy, +oz));
    }
    rotate(rx = 0, ry, rz) {
      return operate(this, rotationXYZ(rx, ry, rz));
    }
    rotateFromVector(x3 = 0, y2 = 0) {
      return operate(this, rotationFromVector(+x3, +y2));
    }
    rotateAxisAngle(x3 = 0, y2 = 0, z3 = 0, angle = 0) {
      return operate(this, rotation(+x3, +y2, +z3, +angle));
    }
    skewX(sx = 0) {
      return operate(this, get2D([1, 0, Math.tan(toRadians(+sx)), 1, 0, 0]));
    }
    skewY(sy = 0) {
      return operate(this, get2D([1, Math.tan(toRadians(+sy)), 0, 1, 0, 0]));
    }
    multiply(other = {}) {
      return operate(this, getMatrixInit(other));
    }
    flipX() {
      return operate(this, get2D([-1, 0, 0, 1, 0, 0]));
    }
    flipY() {
      return operate(this, get2D([1, 0, 0, -1, 0, 0]));
    }
    inverse() {
      return setMatrix(new DOMMatrix2(), invert(getMatrix(this)));
    }
    transformPoint(point) {
      const { x: x3, y: y2, z: z3, w: w3 } = getPointInit(point);
      const m2 = this.#m;
      const row = /* @__PURE__ */ __name((r2) => m2[r2] * x3 + m2[4 + r2] * y2 + m2[8 + r2] * z3 + m2[12 + r2] * w3, "row");
      return new DOMPoint(row(0), row(1), row(2), row(3));
    }
    toFloat32Array() {
      return new Float32Array(this.#m);
    }
    toFloat64Array() {
      return new Float64Array(this.#m);
    }
    toJSON() {
      const json = {};
      for (const [name] of aliases) json[name] = this[name];
      for (const name of names) json[name] = this[name];
      json.is2D = this.is2D;
      json.isIdentity = this.isIdentity;
      return json;
    }
    // `matrix(a, b, c, d, e, f)` or `matrix3d(...)`, its numbers as JavaScript
    // writes them.
    toString() {
      const m2 = this.#m;
      if (!m2.every(Number.isFinite)) {
        throw new DOMException(
          "Unable to write a matrix that is not finite.",
          "InvalidStateError"
        );
      }
      return this.#is2D ? `matrix(${aliases.map(([, , index]) => m2[index]).join(", ")})` : `matrix3d(${m2.join(", ")})`;
    }
    static fromMatrix(other) {
      return setMatrix(new this(), getMatrixInit(other));
    }
    static fromFloat32Array(array) {
      return fromArray(this, array);
    }
    static fromFloat64Array(array) {
      return fromArray(this, array);
    }
  };
  var DOMMatrix2 = class extends DOMMatrixReadOnly {
    static {
      __name(this, "DOMMatrix");
    }
    translateSelf(tx = 0, ty = 0, tz = 0) {
      return change(this, this.translate(tx, ty, tz));
    }
    scaleSelf(sx = 1, sy = sx, sz = 1, ox = 0, oy = 0, oz = 0) {
      return change(this, this.scale(sx, sy, sz, ox, oy, oz));
    }
    scale3dSelf(scale = 1, ox = 0, oy = 0, oz = 0) {
      return change(this, this.scale3d(scale, ox, oy, oz));
    }
    rotateSelf(rx = 0, ry, rz) {
      return change(this, this.rotate(rx, ry, rz));
    }
    rotateFromVectorSelf(x3 = 0, y2 = 0) {
      return change(this, this.rotateFromVector(x3, y2));
    }
    rotateAxisAngleSelf(x3 = 0, y2 = 0, z3 = 0, angle = 0) {
      return change(this, this.rotateAxisAngle(x3, y2, z3, angle));
    }
    skewXSelf(sx = 0) {
      return change(this, this.skewX(sx));
    }
    skewYSelf(sy = 0) {
      return change(this, this.skewY(sy));
    }
    multiplySelf(other = {}) {
      return change(this, this.multiply(other));
    }
    preMultiplySelf(other = {}) {
      return setMatrix(this, multiply(getMatrixInit(other), getMatrix(this)));
    }
    invertSelf() {
      return setMatrix(this, invert(getMatrix(this)));
    }
    setMatrixValue(transformList) {
      return setMatrix(this, getMatrixFromCSS(String(transformList)));
    }
  };
  defineAttributes(
    DOMPointReadOnly,
    DOMPoint,
    ["x", "y", "z", "w"].map((name, index) => [name, index]),
    (point) => getPoint(point)
  );
  defineAttributes(
    DOMRectReadOnly,
    DOMRect,
    ["x", "y", "width", "height"].map((name, index) => [name, index]),
    (rect) => getRect(rect)
  );
  defineAttributes(
    DOMMatrixReadOnly,
    DOMMatrix2,
    [
      ...aliases.map(([name, , index]) => [name, index]),
      ...names.map((name, index) => [name, index])
    ],
    (matrix) => getMatrix(matrix)[0],
    // A matrix that gets a 3D value isn't 2D anymore:
    (matrix, index, value) => {
      if (threeD.some(([, i2, value2D]) => i2 === index && value !== value2D)) {
        setMatrix(matrix, [getMatrix(matrix)[0], false]);
      }
    }
  );
  setToStringTag(
    DOMPointReadOnly,
    DOMPoint,
    DOMRectReadOnly,
    DOMRect,
    DOMQuad,
    DOMMatrixReadOnly,
    DOMMatrix2
  );
  function defineAttributes(ReadOnly, Writable, entries, getValues3, changed) {
    for (const [name, index] of entries) {
      inject(
        ReadOnly.prototype,
        {
          get [name]() {
            return getValues3(this)[index];
          }
        },
        { enumerable: true }
      );
      inject(
        Writable.prototype,
        {
          get [name]() {
            return getValues3(this)[index];
          },
          set [name](value) {
            getValues3(this)[index] = +value;
            changed?.(this, index, +value);
          }
        },
        { enumerable: true }
      );
    }
  }
  __name(defineAttributes, "defineAttributes");
  function change(matrix, result) {
    return setMatrix(matrix, getMatrix(result));
  }
  __name(change, "change");
  function operate(matrix, other) {
    return setMatrix(new DOMMatrix2(), multiply(getMatrix(matrix), other));
  }
  __name(operate, "operate");
  function multiply([a3, is2DA], [b3, is2DB]) {
    const m2 = [];
    for (let i2 = 0; i2 < 16; i2++) {
      const column = Math.floor(i2 / 4);
      const row = i2 % 4;
      let value = 0;
      for (let k2 = 0; k2 < 4; k2++) value += a3[k2 * 4 + row] * b3[column * 4 + k2];
      m2.push(value);
    }
    return [m2, is2DA && is2DB];
  }
  __name(multiply, "multiply");
  function getMatrixFromCSS(text) {
    return (text === "" ? [] : parseTransformList(text)).map(({ name, args }) => getTransform(name, args)).reduce(multiply, [[...identity], true]);
  }
  __name(getMatrixFromCSS, "getMatrixFromCSS");
  function getTransform(name, args) {
    const [a3, b3, c2, d2] = args;
    const tan = /* @__PURE__ */ __name((degrees) => Math.tan(toRadians(degrees)), "tan");
    const [m2, is2D] = {
      matrix: /* @__PURE__ */ __name(() => get2D(args), "matrix"),
      matrix3d: /* @__PURE__ */ __name(() => [args, false], "matrix3d"),
      translate: /* @__PURE__ */ __name(() => translation(a3, b3 ?? 0, 0), "translate"),
      translatex: /* @__PURE__ */ __name(() => translation(a3, 0, 0), "translatex"),
      translatey: /* @__PURE__ */ __name(() => translation(0, a3, 0), "translatey"),
      translatez: /* @__PURE__ */ __name(() => translation(0, 0, a3), "translatez"),
      translate3d: /* @__PURE__ */ __name(() => translation(a3, b3, c2), "translate3d"),
      scale: /* @__PURE__ */ __name(() => scaling(a3, b3 ?? a3, 1), "scale"),
      scalex: /* @__PURE__ */ __name(() => scaling(a3, 1, 1), "scalex"),
      scaley: /* @__PURE__ */ __name(() => scaling(1, a3, 1), "scaley"),
      scalez: /* @__PURE__ */ __name(() => scaling(1, 1, a3), "scalez"),
      scale3d: /* @__PURE__ */ __name(() => scaling(a3, b3, c2), "scale3d"),
      rotate: /* @__PURE__ */ __name(() => rotation(0, 0, 1, a3), "rotate"),
      rotatex: /* @__PURE__ */ __name(() => rotation(1, 0, 0, a3), "rotatex"),
      rotatey: /* @__PURE__ */ __name(() => rotation(0, 1, 0, a3), "rotatey"),
      rotatez: /* @__PURE__ */ __name(() => rotation(0, 0, 1, a3), "rotatez"),
      rotate3d: /* @__PURE__ */ __name(() => rotation(a3, b3, c2, d2), "rotate3d"),
      skew: /* @__PURE__ */ __name(() => get2D([1, tan(b3 ?? 0), tan(a3), 1, 0, 0]), "skew"),
      skewx: /* @__PURE__ */ __name(() => get2D([1, 0, tan(a3), 1, 0, 0]), "skewx"),
      skewy: /* @__PURE__ */ __name(() => get2D([1, tan(a3), 0, 1, 0, 0]), "skewy"),
      // `m34`, of a distance of 1 at least:
      perspective: /* @__PURE__ */ __name(() => {
        const m3 = [...identity];
        m3[11] = -1 / Math.max(a3, 1);
        return [m3, false];
      }, "perspective")
    }[name]();
    return [m2, is2D && !/3d$|z$|^rotate[xy]$|^perspective$/.test(name)];
  }
  __name(getTransform, "getTransform");
  function get2D([a3, b3, c2, d2, e2, f2]) {
    const m2 = [...identity];
    [m2[0], m2[1], m2[4], m2[5], m2[12], m2[13]] = [a3, b3, c2, d2, e2, f2];
    return [m2, true];
  }
  __name(get2D, "get2D");
  function translation(x3, y2, z3) {
    const m2 = [...identity];
    [m2[12], m2[13], m2[14]] = [x3, y2, z3];
    return [m2, z3 === 0];
  }
  __name(translation, "translation");
  function scaling(x3, y2, z3) {
    const m2 = [...identity];
    [m2[0], m2[5], m2[10]] = [x3, y2, z3];
    return [m2, z3 === 1];
  }
  __name(scaling, "scaling");
  function scalingAround(sx, sy, sz, ox, oy, oz) {
    return multiply(
      multiply(translation(ox, oy, oz), scaling(sx, sy, sz)),
      translation(-ox, -oy, -oz)
    );
  }
  __name(scalingAround, "scalingAround");
  function rotationXYZ(rx, ry, rz) {
    const [x3, y2, z3] = ry === void 0 && rz === void 0 ? [0, 0, +rx] : [+rx, +(ry ?? 0), +(rz ?? 0)];
    let result = rotation(0, 0, 1, z3);
    if (y2 !== 0) result = multiply(result, rotation(0, 1, 0, y2));
    if (x3 !== 0) result = multiply(result, rotation(1, 0, 0, x3));
    return result;
  }
  __name(rotationXYZ, "rotationXYZ");
  function rotationFromVector(x3, y2) {
    return rotation(
      0,
      0,
      1,
      x3 === 0 && y2 === 0 ? 0 : Math.atan2(y2, x3) * 180 / Math.PI
    );
  }
  __name(rotationFromVector, "rotationFromVector");
  function rotation(x3, y2, z3, degrees) {
    const is2D = x3 === 0 && y2 === 0;
    const length = Math.hypot(x3, y2, z3);
    if (length === 0 || !Number.isFinite(length)) return [[...identity], is2D];
    [x3, y2, z3] = [x3 / length, y2 / length, z3 / length];
    const half = toRadians(degrees) / 2;
    const sc = Math.sin(half) * Math.cos(half);
    const sq = Math.sin(half) ** 2;
    const m2 = [
      1 - 2 * (y2 * y2 + z3 * z3) * sq,
      2 * (x3 * y2 * sq + z3 * sc),
      2 * (x3 * z3 * sq - y2 * sc),
      0,
      2 * (x3 * y2 * sq - z3 * sc),
      1 - 2 * (x3 * x3 + z3 * z3) * sq,
      2 * (y2 * z3 * sq + x3 * sc),
      0,
      2 * (x3 * z3 * sq + y2 * sc),
      2 * (y2 * z3 * sq - x3 * sc),
      1 - 2 * (x3 * x3 + y2 * y2) * sq,
      0,
      0,
      0,
      0,
      1
    ];
    return [m2, is2D];
  }
  __name(rotation, "rotation");
  function invert([m2, is2D]) {
    const singular = [new Array(16).fill(NaN), false];
    if (!m2.every(Number.isFinite)) return singular;
    if (is2D) {
      const [a3, b3, c2, d2, e2, f2] = aliases.map(([, , index]) => m2[index]);
      const det2 = a3 * d2 - b3 * c2;
      return det2 === 0 ? singular : get2D([
        d2 / det2,
        -b3 / det2,
        -c2 / det2,
        a3 / det2,
        (c2 * f2 - d2 * e2) / det2,
        (b3 * e2 - a3 * f2) / det2
      ]);
    }
    const i2 = [
      m2[5] * m2[10] * m2[15] - m2[5] * m2[11] * m2[14] - m2[9] * m2[6] * m2[15] + m2[9] * m2[7] * m2[14] + m2[13] * m2[6] * m2[11] - m2[13] * m2[7] * m2[10],
      -m2[1] * m2[10] * m2[15] + m2[1] * m2[11] * m2[14] + m2[9] * m2[2] * m2[15] - m2[9] * m2[3] * m2[14] - m2[13] * m2[2] * m2[11] + m2[13] * m2[3] * m2[10],
      m2[1] * m2[6] * m2[15] - m2[1] * m2[7] * m2[14] - m2[5] * m2[2] * m2[15] + m2[5] * m2[3] * m2[14] + m2[13] * m2[2] * m2[7] - m2[13] * m2[3] * m2[6],
      -m2[1] * m2[6] * m2[11] + m2[1] * m2[7] * m2[10] + m2[5] * m2[2] * m2[11] - m2[5] * m2[3] * m2[10] - m2[9] * m2[2] * m2[7] + m2[9] * m2[3] * m2[6],
      -m2[4] * m2[10] * m2[15] + m2[4] * m2[11] * m2[14] + m2[8] * m2[6] * m2[15] - m2[8] * m2[7] * m2[14] - m2[12] * m2[6] * m2[11] + m2[12] * m2[7] * m2[10],
      m2[0] * m2[10] * m2[15] - m2[0] * m2[11] * m2[14] - m2[8] * m2[2] * m2[15] + m2[8] * m2[3] * m2[14] + m2[12] * m2[2] * m2[11] - m2[12] * m2[3] * m2[10],
      -m2[0] * m2[6] * m2[15] + m2[0] * m2[7] * m2[14] + m2[4] * m2[2] * m2[15] - m2[4] * m2[3] * m2[14] - m2[12] * m2[2] * m2[7] + m2[12] * m2[3] * m2[6],
      m2[0] * m2[6] * m2[11] - m2[0] * m2[7] * m2[10] - m2[4] * m2[2] * m2[11] + m2[4] * m2[3] * m2[10] + m2[8] * m2[2] * m2[7] - m2[8] * m2[3] * m2[6],
      m2[4] * m2[9] * m2[15] - m2[4] * m2[11] * m2[13] - m2[8] * m2[5] * m2[15] + m2[8] * m2[7] * m2[13] + m2[12] * m2[5] * m2[11] - m2[12] * m2[7] * m2[9],
      -m2[0] * m2[9] * m2[15] + m2[0] * m2[11] * m2[13] + m2[8] * m2[1] * m2[15] - m2[8] * m2[3] * m2[13] - m2[12] * m2[1] * m2[11] + m2[12] * m2[3] * m2[9],
      m2[0] * m2[5] * m2[15] - m2[0] * m2[7] * m2[13] - m2[4] * m2[1] * m2[15] + m2[4] * m2[3] * m2[13] + m2[12] * m2[1] * m2[7] - m2[12] * m2[3] * m2[5],
      -m2[0] * m2[5] * m2[11] + m2[0] * m2[7] * m2[9] + m2[4] * m2[1] * m2[11] - m2[4] * m2[3] * m2[9] - m2[8] * m2[1] * m2[7] + m2[8] * m2[3] * m2[5],
      -m2[4] * m2[9] * m2[14] + m2[4] * m2[10] * m2[13] + m2[8] * m2[5] * m2[14] - m2[8] * m2[6] * m2[13] - m2[12] * m2[5] * m2[10] + m2[12] * m2[6] * m2[9],
      m2[0] * m2[9] * m2[14] - m2[0] * m2[10] * m2[13] - m2[8] * m2[1] * m2[14] + m2[8] * m2[2] * m2[13] + m2[12] * m2[1] * m2[10] - m2[12] * m2[2] * m2[9],
      -m2[0] * m2[5] * m2[14] + m2[0] * m2[6] * m2[13] + m2[4] * m2[1] * m2[14] - m2[4] * m2[2] * m2[13] - m2[12] * m2[1] * m2[6] + m2[12] * m2[2] * m2[5],
      m2[0] * m2[5] * m2[10] - m2[0] * m2[6] * m2[9] - m2[4] * m2[1] * m2[10] + m2[4] * m2[2] * m2[9] + m2[8] * m2[1] * m2[6] - m2[8] * m2[2] * m2[5]
    ];
    const det = m2[0] * i2[0] + m2[1] * i2[4] + m2[2] * i2[8] + m2[3] * i2[12];
    return det !== 0 && Number.isFinite(det) ? [i2.map((value) => value / det), false] : singular;
  }
  __name(invert, "invert");
  function toRadians(degrees) {
    return degrees * Math.PI / 180;
  }
  __name(toRadians, "toRadians");
  function getDictionary(value, name) {
    if (value == null) return null;
    if (typeof value !== "object" && typeof value !== "function") {
      throw new TypeError(`Invalid ${name}: '${value}'.`);
    }
    return value;
  }
  __name(getDictionary, "getDictionary");
  function getPointInit(point) {
    const {
      x: x3 = 0,
      y: y2 = 0,
      z: z3 = 0,
      w: w3 = 1
    } = getDictionary(point, "DOMPointInit") ?? {};
    return { x: +x3, y: +y2, z: +z3, w: +w3 };
  }
  __name(getPointInit, "getPointInit");
  function getRectInit(rect) {
    const {
      x: x3 = 0,
      y: y2 = 0,
      width = 0,
      height = 0
    } = getDictionary(rect, "DOMRectInit") ?? {};
    return { x: +x3, y: +y2, width: +width, height: +height };
  }
  __name(getRectInit, "getRectInit");
  function getMatrixInit(init) {
    init = getDictionary(init, "DOMMatrixInit") ?? {};
    const m2 = [...identity];
    for (const [alias, name, index] of aliases) {
      const aliasValue = init[alias] === void 0 ? void 0 : +init[alias];
      const value = init[name] === void 0 ? void 0 : +init[name];
      if (aliasValue !== void 0 && value !== void 0 && // Agreeing, as 0 and -0 do, and NaN and NaN:
      aliasValue !== value && !Object.is(aliasValue, value)) {
        throw new TypeError(`Invalid matrix: its ${name} and ${alias} disagree.`);
      }
      m2[index] = value ?? aliasValue ?? m2[index];
    }
    let hasThreeD = false;
    for (const [name, index, default2D] of threeD) {
      if (init[name] !== void 0) {
        m2[index] = +init[name];
        hasThreeD ||= m2[index] !== default2D;
      }
    }
    const is2D = init.is2D === void 0 ? void 0 : !!init.is2D;
    if (is2D && hasThreeD) {
      throw new TypeError("Invalid matrix: a 2D matrix has 3D values.");
    }
    return [m2, is2D ?? !hasThreeD];
  }
  __name(getMatrixInit, "getMatrixInit");
  function getMatrixFromList(list) {
    const values = Array.from(list ?? [], Number);
    if (values.length === 6) return get2D(values);
    if (values.length === 16) return [values, false];
    throw new TypeError("Invalid matrix: it takes 6 or 16 numbers.");
  }
  __name(getMatrixFromList, "getMatrixFromList");
  function fromArray(Class, array) {
    if (!ArrayBuffer.isView(array)) {
      throw new TypeError(`Invalid array: '${array}', not a typed array.`);
    }
    return setMatrix(new Class(), getMatrixFromList(array));
  }
  __name(fromArray, "fromArray");
  function getGeometryValues(object) {
    return object instanceof DOMPointReadOnly ? getPoint(object) : object instanceof DOMRectReadOnly ? getRect(object) : object instanceof DOMQuad ? getQuad(object).flatMap(getPoint) : object instanceof DOMMatrixReadOnly ? [...getMatrix(object)[0], getMatrix(object)[1] ? 1 : 0] : null;
  }
  __name(getGeometryValues, "getGeometryValues");

  // src/text-metrics.js
  var numbers = [
    "width",
    "actualBoundingBoxLeft",
    "actualBoundingBoxRight",
    "actualBoundingBoxAscent",
    "actualBoundingBoxDescent",
    "fontBoundingBoxAscent",
    "fontBoundingBoxDescent",
    "emHeightAscent",
    "emHeightDescent",
    "hangingBaseline",
    "alphabeticBaseline",
    "ideographicBaseline"
  ];
  var textSettings = [
    "font",
    "letterSpacing",
    "wordSpacing",
    "fontKerning",
    "fontVariantCaps",
    "direction",
    "lang"
  ];
  var getValues;
  var getClusterSettings;
  var TextMetrics = class {
    static {
      __name(this, "TextMetrics");
    }
    #values;
    #text;
    #settings;
    // Each cluster's start and end, left and advance, and its ink's left, right,
    // top and bottom (heights):
    #clusters = [];
    constructor(key, values, text, settings) {
      checkInternal(key, "TextMetrics", "measureText() makes them");
      this.#values = values;
      this.#text = text;
      this.#settings = settings;
      const { clusters } = values;
      for (let at2 = 0; at2 < clusters.length; at2 += 8) {
        const [start, end, left, advance, inkLeft, inkRight, top, bottom] = clusters.subarray(at2, at2 + 8);
        this.#clusters.push({
          start,
          end,
          left,
          advance,
          inkLeft,
          inkRight,
          top,
          bottom
        });
      }
    }
    static {
      getValues = /* @__PURE__ */ __name((metrics) => metrics.#values, "getValues");
    }
    // The clusters of the text from `start` to `end`, positioned by `align` and
    // `baseline`, by default the context's when it was measured.
    getTextClusters(...args) {
      const [start, end, options = {}] = args.length > 1 ? args : [0, this.#text.length, args[0]];
      const {
        align = this.#settings.textAlign,
        baseline = this.#settings.textBaseline
      } = options;
      const y2 = -this.#getBaselineHeight(baseline);
      return this.#getClusters(start, end, "getTextClusters").map(
        (cluster) => new TextCluster(
          internal,
          {
            text: this.#text.slice(cluster.start, cluster.end),
            x: cluster.left + getAlignOffset(align, cluster.advance, this.#settings),
            y: y2,
            start: cluster.start,
            end: cluster.end,
            align,
            baseline
          },
          this.#settings
        )
      );
    }
    // The bounds of the ink of the text from `start` to `end`:
    getActualBoundingBox(start, end) {
      checkArguments(arguments, 2, "getActualBoundingBox");
      const inked = this.#getClusters(start, end, "getActualBoundingBox").filter(
        (cluster) => cluster.inkRight > cluster.inkLeft
      );
      if (!inked.length) {
        return new DOMRectReadOnly();
      }
      const left = Math.min(...inked.map((cluster) => cluster.inkLeft));
      const right = Math.max(...inked.map((cluster) => cluster.inkRight));
      const top = Math.max(...inked.map((cluster) => cluster.top));
      const bottom = Math.min(...inked.map((cluster) => cluster.bottom));
      return new DOMRectReadOnly(left, -top, right - left, top - bottom);
    }
    // The rectangles that select the text from `start` to `end`, as tall as the
    // font's bounding box:
    getSelectionRects(start, end) {
      checkArguments(arguments, 2, "getSelectionRects");
      const { fontBoundingBoxAscent: ascent, fontBoundingBoxDescent: descent } = this.#values;
      const rects = [];
      for (const { left, advance } of this.#getClusters(
        start,
        end,
        "getSelectionRects"
      )) {
        const last = rects.at(-1);
        if (last && Math.abs(last.right - left) < 1e-6) {
          last.width += advance;
        } else {
          rects.push(new DOMRect(left, -ascent, advance, ascent + descent));
        }
      }
      return rects;
    }
    // The index of the character position nearest to `offset`, from the text's
    // position: before a cluster up to its middle, after it beyond, in the
    // cluster's own direction, which the next character shows.
    getIndexFromOffset(offset) {
      checkArguments(arguments, 1, "getIndexFromOffset");
      offset = Number(offset);
      const clusters = this.#clusters;
      const isRightToLeft = /* @__PURE__ */ __name((index) => {
        const [cluster, next, previous] = [index, index + 1, index - 1].map(
          (i2) => clusters[i2]
        );
        return next ? next.left < cluster.left : previous ? previous.left > cluster.left : this.#settings.direction === "rtl";
      }, "isRightToLeft");
      const visual = clusters.map((cluster, index) => ({ ...cluster, rtl: isRightToLeft(index) })).sort((a3, b3) => a3.left - b3.left);
      for (const { start, end, left, advance, rtl } of visual) {
        if (offset <= left + advance / 2) {
          return rtl ? end : start;
        }
      }
      return this.#settings.direction === "rtl" ? 0 : this.#text.length;
    }
    // A start after the end selects nothing for `getSelectionRects()`.
    #getClusters(start, end, name) {
      start = getIndex(start, name);
      end = getIndex(end, name);
      const { length } = this.#text;
      if (start > length || end > length || start > end && name !== "getSelectionRects") {
        throw new DOMException(
          `Invalid ${name}(): ${start} to ${end} isn't in the text.`,
          "IndexSizeError"
        );
      }
      return this.#clusters.filter(
        (cluster) => cluster.start < end && cluster.end > start
      );
    }
    // The height of the baseline above the text's position:
    #getBaselineHeight(baseline) {
      const values = this.#values;
      return {
        top: values.emHeightAscent,
        hanging: values.hangingBaseline,
        middle: (values.emHeightAscent - values.emHeightDescent) / 2,
        alphabetic: values.alphabeticBaseline,
        ideographic: values.ideographicBaseline,
        bottom: -values.emHeightDescent
      }[baseline] ?? values.alphabeticBaseline;
    }
  };
  for (const name of numbers) {
    inject(
      TextMetrics.prototype,
      {
        get [name]() {
          return getValues(this)[name];
        }
      },
      { enumerable: true }
    );
  }
  var TextCluster = class {
    static {
      __name(this, "TextCluster");
    }
    #values;
    #settings;
    constructor(key, values, settings) {
      checkInternal(key, "TextCluster", "getTextClusters() makes them");
      this.#values = values;
      this.#settings = settings;
    }
    static {
      getClusterSettings = /* @__PURE__ */ __name((cluster) => cluster.#settings, "getClusterSettings");
    }
    get text() {
      return this.#values.text;
    }
    get x() {
      return this.#values.x;
    }
    get y() {
      return this.#values.y;
    }
    get start() {
      return this.#values.start;
    }
    get end() {
      return this.#values.end;
    }
    get align() {
      return this.#values.align;
    }
    get baseline() {
      return this.#values.baseline;
    }
  };
  setToStringTag(TextMetrics, TextCluster);
  function drawCluster(context, draw, cluster, x3, y2, options = {}) {
    if (!(cluster instanceof TextCluster)) {
      throw new TypeError(`Invalid text cluster: '${cluster}'.`);
    }
    const {
      align = cluster.align,
      baseline = cluster.baseline,
      x: dx = cluster.x,
      y: dy = cluster.y
    } = options;
    context.save();
    Object.assign(context, getClusterSettings(cluster), {
      textAlign: align,
      textBaseline: baseline
    });
    context[draw](cluster.text, Number(x3) + dx, Number(y2) + dy);
    context.restore();
  }
  __name(drawCluster, "drawCluster");
  function getAlignOffset(align, advance, { direction }) {
    const rtl = direction === "rtl";
    return align === "center" ? advance / 2 : align === "right" || align === "end" && !rtl || align === "start" && rtl ? advance : 0;
  }
  __name(getAlignOffset, "getAlignOffset");
  function getIndex(value, name) {
    const index = Math.trunc(Number(value));
    if (!(index >= 0 && index <= 2 ** 32 - 1)) {
      throw new TypeError(`Invalid ${name}(): '${value}' isn't an index.`);
    }
    return index;
  }
  __name(getIndex, "getIndex");

  // src/canvas.js
  var { canvas } = natives;
  var getCanvasSurface;
  var getBitmapSurface;
  var getPath;
  var getGradientPaint;
  var getPatternPaint;
  var registry = globalThis.FinalizationRegistry && new FinalizationRegistry(([kind, slot]) => canvas.release(kind, slot));
  var contextTypes = ["2d", "bitmaprenderer", "webgl", "webgl2", "webgpu"];
  var OffscreenCanvas = class {
    static {
      __name(this, "OffscreenCanvas");
    }
    #surface;
    #width;
    #height;
    #context = null;
    // Transparent black, with a context's defaults. A canvas larger than its
    // pixels may be keeps its size, and has none, as a browser's that couldn't
    // be made.
    constructor(width, height) {
      checkArguments(arguments, 2, "OffscreenCanvas");
      this.#width = getSize(width);
      this.#height = getSize(height);
      this.#surface = canvas.create(this.#width, this.#height);
      registry?.register(this, ["surface", this.#surface]);
    }
    static {
      getCanvasSurface = /* @__PURE__ */ __name((canvas2) => canvas2.#surface, "getCanvasSurface");
    }
    // The same 2D context each time, made with the options it's first asked
    // for with; `null` for the other kinds.
    getContext(type, options) {
      checkArguments(arguments, 1, "getContext");
      type = String(type);
      if (!contextTypes.includes(type)) {
        throw new TypeError(`Invalid context type: '${type}'.`);
      }
      if (type === "2d" && !this.#context) {
        const attributes = getContextAttributes(options);
        if (!attributes.alpha) {
          canvas.setOpaque.call(this.#surface);
        }
        this.#context = new OffscreenCanvasRenderingContext2D(
          internal,
          this,
          this.#surface,
          attributes
        );
      }
      return type === "2d" ? this.#context : null;
    }
    get width() {
      return this.#width;
    }
    // Cleared to the new size, its state reset, as in browsers:
    set width(width) {
      this.#width = getSize(width);
      canvas.resize.call(this.#surface, this.#width, this.#height);
    }
    get height() {
      return this.#height;
    }
    set height(height) {
      this.#height = getSize(height);
      canvas.resize.call(this.#surface, this.#width, this.#height);
    }
    // A PNG, JPEG or WebP file of the canvas, PNG for other types:
    async convertToBlob({ type = "image/png", quality } = {}) {
      if (this.#width === 0 || this.#height === 0) {
        throw new DOMException(
          "Invalid convertToBlob(): a canvas of no size.",
          "IndexSizeError"
        );
      }
      const [bytes, kind] = canvas.encode.call(
        this.#surface,
        String(type),
        quality
      );
      return new globalThis.Blob([bytes], { type: kind });
    }
    // What the canvas shows, as an `ImageBitmap`, the canvas cleared:
    transferToImageBitmap() {
      if (!this.#context) {
        throw new DOMException(
          "Invalid transferToImageBitmap(): the canvas has no context.",
          "InvalidStateError"
        );
      }
      const bitmap = new ImageBitmap(
        internal,
        canvas.createImageBitmap(this.#surface)
      );
      canvas.clear.call(this.#surface);
      return bitmap;
    }
  };
  var getContextSurface;
  var OffscreenCanvasRenderingContext2D = class {
    static {
      __name(this, "OffscreenCanvasRenderingContext2D");
    }
    #canvas;
    #surface;
    #attributes;
    constructor(key, offscreen, surface, attributes) {
      checkInternal(
        key,
        "OffscreenCanvasRenderingContext2D",
        "getContext() makes them"
      );
      this.#canvas = offscreen;
      this.#surface = surface;
      this.#attributes = attributes;
    }
    static {
      getContextSurface = /* @__PURE__ */ __name((context) => context.#surface, "getContextSurface");
    }
    get canvas() {
      return this.#canvas;
    }
    getContextAttributes() {
      return { ...this.#attributes };
    }
    measureText(text) {
      checkArguments(arguments, 1, "measureText");
      text = String(text);
      const settings = Object.fromEntries(
        [...textSettings, "textAlign", "textBaseline"].map((key) => [
          key,
          this[key]
        ])
      );
      return new TextMetrics(
        internal,
        canvas.methods.measureText.call(this.#surface, text),
        text,
        settings
      );
    }
    fillTextCluster(cluster, x3, y2, options) {
      checkArguments(arguments, 3, "fillTextCluster");
      drawCluster(this, "fillText", cluster, x3, y2, options);
    }
    strokeTextCluster(cluster, x3, y2, options) {
      checkArguments(arguments, 3, "strokeTextCluster");
      drawCluster(this, "strokeText", cluster, x3, y2, options);
    }
    // Transparent black, of a size, either way round, or of another
    // `ImageData`'s.
    createImageData(widthOrImage, height) {
      checkArguments(arguments, 1, "createImageData");
      if (widthOrImage instanceof ImageData) {
        return new ImageData(widthOrImage.width, widthOrImage.height);
      } else {
        checkArguments(arguments, 2, "createImageData");
        return new ImageData(
          Math.abs(getLong(widthOrImage)),
          Math.abs(getLong(height))
        );
      }
    }
    getImageData(x3, y2, width, height) {
      checkArguments(arguments, 4, "getImageData");
      const args = [x3, y2, width, height].map(getLong);
      if (args[2] === 0 || args[3] === 0) {
        throw new DOMException(
          "Invalid getImageData(): the width and height must not be 0.",
          "IndexSizeError"
        );
      }
      return canvas.methods.getImageData.call(this.#surface, ...args);
    }
    putImageData(image, ...args) {
      checkOverloads(arguments, [3, 7], "putImageData");
      if (!(image instanceof ImageData)) {
        throw new TypeError("Invalid putImageData(): not an ImageData.");
      }
      return canvas.methods.putImageData.call(
        this.#surface,
        image,
        ...args.slice(0, arguments.length === 3 ? 2 : 6).map(getLong)
      );
    }
    createLinearGradient(x0, y0, x1, y1) {
      checkArguments(arguments, 4, "createLinearGradient");
      return createGradient("linear", x0, y0, x1, y1);
    }
    createRadialGradient(x0, y0, r0, x1, y1, r1) {
      checkArguments(arguments, 6, "createRadialGradient");
      return createGradient("radial", x0, y0, r0, x1, y1, r1);
    }
    createConicGradient(angle, x3, y2) {
      checkArguments(arguments, 3, "createConicGradient");
      return createGradient("conic", angle, x3, y2);
    }
    createPattern(image, repetition) {
      checkArguments(arguments, 2, "createPattern");
      return new CanvasPattern(
        internal,
        canvas.createPattern(getSurface(image), repetition)
      );
    }
    drawImage(image, ...args) {
      checkOverloads(arguments, [3, 5, 9], "drawImage");
      canvas.methods.drawImage.call(this.#surface, getSurface(image), ...args);
    }
    // The path first, `null` for the current one:
    fill(...args) {
      return callWithPath(this.#surface, "fill", args, 0, true);
    }
    stroke(...args) {
      return callWithPath(this.#surface, "stroke", args, 0);
    }
    clip(...args) {
      return callWithPath(this.#surface, "clip", args, 0, true);
    }
    isPointInPath(...args) {
      return callWithPath(this.#surface, "isPointInPath", args, 2, true);
    }
    isPointInStroke(...args) {
      return callWithPath(this.#surface, "isPointInStroke", args, 2);
    }
    roundRect(x3, y2, w3, h2, radii) {
      checkArguments(arguments, 4, "roundRect");
      const args = getRoundRect(x3, y2, w3, h2, radii);
      if (args) canvas.methods.roundRect.call(this.#surface, ...args);
    }
  };
  var contextMethods = {
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
  };
  var numberMethods = /* @__PURE__ */ new Set([
    "moveTo",
    "lineTo",
    "bezierCurveTo",
    "quadraticCurveTo",
    "arc",
    "arcTo",
    "ellipse",
    "rect",
    "fillRect",
    "strokeRect",
    "clearRect",
    "translate",
    "rotate",
    "scale",
    "transform"
  ]);
  for (const [name, counts] of Object.entries(contextMethods)) {
    inject(OffscreenCanvasRenderingContext2D.prototype, {
      [name](...args) {
        checkOverloads(args, counts, name);
        return canvas.methods[name].call(
          getContextSurface(this),
          ...getArguments2(name, args, counts)
        );
      }
    });
  }
  for (const name of canvas.properties) {
    inject(
      OffscreenCanvasRenderingContext2D.prototype,
      {
        get [name]() {
          return canvas.get.call(getContextSurface(this), name);
        },
        set [name](value) {
          canvas.set.call(getContextSurface(this), name, value, getPaint(value));
        }
      },
      { enumerable: true }
    );
  }
  var ImageData = class {
    static {
      __name(this, "ImageData");
    }
    #data;
    #width;
    #height;
    // `new ImageData(width, height)`, transparent black, or
    // `new ImageData(data, width[, height])` of RGBA `data`, not premultiplied.
    constructor(dataOrWidth, width, height) {
      checkArguments(arguments, 2, "ImageData");
      if (dataOrWidth instanceof Uint8ClampedArray) {
        const data = dataOrWidth;
        width = getSide(width);
        height = height === void 0 ? data.length / 4 / width : getSide(height);
        if (data.length !== width * height * 4) {
          throw new DOMException(
            "Invalid ImageData: the data is not width \xD7 height \xD7 4 bytes.",
            "IndexSizeError"
          );
        }
        this.#data = data;
      } else {
        height = getSide(width);
        width = getSide(dataOrWidth);
        this.#data = new Uint8ClampedArray(width * height * 4);
      }
      this.#width = width;
      this.#height = height;
    }
    get width() {
      return this.#width;
    }
    get height() {
      return this.#height;
    }
    get data() {
      return this.#data;
    }
    get colorSpace() {
      return "srgb";
    }
    get pixelFormat() {
      return "rgba-unorm8";
    }
  };
  var Path2D = class _Path2D {
    static {
      __name(this, "Path2D");
    }
    #path;
    constructor(path) {
      this.#path = canvas.createPath(
        path instanceof _Path2D ? path.#path : path === void 0 ? null : String(path)
      );
      registry?.register(this, ["path", this.#path]);
    }
    static {
      getPath = /* @__PURE__ */ __name((path) => path instanceof _Path2D ? path.#path : void 0, "getPath");
    }
    roundRect(x3, y2, w3, h2, radii) {
      checkArguments(arguments, 4, "roundRect");
      const args = getRoundRect(x3, y2, w3, h2, radii);
      if (args) canvas.pathMethods.roundRect.call(this.#path, ...args);
    }
    addPath(path, transform) {
      checkArguments(arguments, 1, "addPath");
      canvas.pathMethods.addPath.call(this.#path, getPath(path), transform);
    }
  };
  for (const name of [
    "closePath",
    "moveTo",
    "lineTo",
    "bezierCurveTo",
    "quadraticCurveTo",
    "arc",
    "arcTo",
    "ellipse",
    "rect"
  ]) {
    const counts = contextMethods[name];
    inject(Path2D.prototype, {
      [name](...args) {
        checkOverloads(args, counts, name);
        return canvas.pathMethods[name].call(
          getPath(this),
          ...getArguments2(name, args, counts)
        );
      }
    });
  }
  var ImageBitmap = class {
    static {
      __name(this, "ImageBitmap");
    }
    #surface;
    constructor(key, surface) {
      checkInternal(key, "ImageBitmap", "createImageBitmap() makes them");
      this.#surface = surface;
      registry?.register(this, ["surface", surface], this);
    }
    static {
      getBitmapSurface = /* @__PURE__ */ __name((bitmap) => {
        if (bitmap.#surface === null) {
          throw new DOMException(
            "the image bitmap is closed",
            "InvalidStateError"
          );
        }
        return bitmap.#surface;
      }, "getBitmapSurface");
    }
    // None once it's closed:
    get width() {
      return this.#surface === null ? 0 : canvas.width.call(this.#surface);
    }
    get height() {
      return this.#surface === null ? 0 : canvas.height.call(this.#surface);
    }
    close() {
      if (this.#surface !== null) {
        registry?.unregister(this);
        canvas.release("surface", this.#surface);
        this.#surface = null;
      }
    }
  };
  var CanvasGradient = class {
    static {
      __name(this, "CanvasGradient");
    }
    #paint;
    constructor(key, paint) {
      checkInternal(key, "CanvasGradient", "the context makes them");
      this.#paint = paint;
      registry?.register(this, ["paint", paint]);
    }
    static {
      getGradientPaint = /* @__PURE__ */ __name((gradient) => gradient.#paint, "getGradientPaint");
    }
    addColorStop(offset, color) {
      checkArguments(arguments, 2, "addColorStop");
      canvas.addColorStop.call(this.#paint, getFinite(offset), color);
    }
  };
  var CanvasPattern = class {
    static {
      __name(this, "CanvasPattern");
    }
    #paint;
    constructor(key, paint) {
      checkInternal(key, "CanvasPattern", "the context makes them");
      this.#paint = paint;
      registry?.register(this, ["paint", paint]);
    }
    static {
      getPatternPaint = /* @__PURE__ */ __name((pattern) => pattern.#paint, "getPatternPaint");
    }
    setTransform(transform = {}) {
      const { a: a3, b: b3, c: c2, d: d2, e: e2, f: f2 } = DOMMatrix.fromMatrix(transform);
      canvas.setPatternTransform.call(this.#paint, a3, b3, c2, d2, e2, f2);
    }
  };
  setToStringTag(
    OffscreenCanvas,
    OffscreenCanvasRenderingContext2D,
    ImageData,
    Path2D,
    ImageBitmap,
    CanvasGradient,
    CanvasPattern
  );
  async function createImageBitmap(image, ...args) {
    const source = image instanceof globalThis.Blob ? new Uint8Array(await image.arrayBuffer()) : image instanceof ImageData ? image : getSurface(image);
    return new ImageBitmap(internal, canvas.createImageBitmap(source, ...args));
  }
  __name(createImageBitmap, "createImageBitmap");
  function getSurface(image) {
    if (image instanceof OffscreenCanvas) {
      if (image.width === 0 || image.height === 0) {
        throw new DOMException(
          "Invalid image: a canvas of no size.",
          "InvalidStateError"
        );
      }
      return getCanvasSurface(image);
    } else if (image instanceof ImageBitmap) {
      return getBitmapSurface(image);
    } else {
      throw new TypeError(`Invalid image: '${image}', not a canvas or bitmap.`);
    }
  }
  __name(getSurface, "getSurface");
  function getPaint(style) {
    return style instanceof CanvasGradient ? getGradientPaint(style) : style instanceof CanvasPattern ? getPatternPaint(style) : void 0;
  }
  __name(getPaint, "getPaint");
  function createGradient(kind, ...args) {
    return new CanvasGradient(internal, canvas.createGradient(kind, ...args));
  }
  __name(createGradient, "createGradient");
  function callWithPath(surface, name, args, count, hasFillRule) {
    const path = args[0] instanceof Path2D ? getPath(args.shift()) : null;
    checkArguments(args, count, name);
    if (hasFillRule) {
      if (!path && args.length > count + 1) {
        throw new TypeError(`Invalid ${name}(): ${args.length} arguments.`);
      }
      args[count] = getFillRule(args[count]);
    }
    return canvas.methods[name].call(surface, path, ...args);
  }
  __name(callWithPath, "callWithPath");
  function getArguments2(name, args, count) {
    return numberMethods.has(name) ? args.map((arg, index) => index < count ? Number(arg) : arg) : args;
  }
  __name(getArguments2, "getArguments");
  function getFillRule(value = "nonzero") {
    const rule = String(value);
    if (rule !== "nonzero" && rule !== "evenodd") {
      throw new TypeError(`Invalid fill rule: '${rule}'.`);
    }
    return rule;
  }
  __name(getFillRule, "getFillRule");
  function checkOverloads(args, counts, name) {
    if (typeof counts === "number") {
      checkArguments(args, counts, name);
    } else {
      const count = Math.min(args.length, Math.max(...counts));
      if (!counts.includes(count) || count === 1 && !isObject(args[0])) {
        throw new TypeError(`Invalid ${name}(): ${args.length} arguments.`);
      }
    }
  }
  __name(checkOverloads, "checkOverloads");
  function isObject(value) {
    return value !== null && typeof value === "object";
  }
  __name(isObject, "isObject");
  function getSize(value) {
    const size = Math.trunc(Number(value));
    if (!(size >= 0 && size <= Number.MAX_SAFE_INTEGER)) {
      throw new TypeError(`Invalid canvas size: '${value}'.`);
    }
    return size;
  }
  __name(getSize, "getSize");
  function getRoundRect(x3, y2, w3, h2, radii = 0) {
    const list = isObject(radii) && typeof radii[Symbol.iterator] === "function" ? Array.from(radii) : [radii];
    if (list.length < 1 || list.length > 4) {
      throw new RangeError(
        `Invalid roundRect() radii: ${list.length}, not 1 to 4.`
      );
    }
    const corners = list.map((radius) => {
      const { x: rx = 0, y: ry = 0 } = isObject(radius) || radius === void 0 ? radius ?? {} : { x: radius, y: radius };
      return [+rx, +ry];
    });
    const numbers2 = [+x3, +y2, +w3, +h2, ...corners.flat()];
    if (!numbers2.every(Number.isFinite)) return null;
    if (corners.flat().some((r2) => r2 < 0)) {
      throw new RangeError("Invalid roundRect() radius: it is negative.");
    }
    const [a3, b3 = a3, c2 = a3, d2 = b3] = corners;
    let [ul, ur2, lr2, ll] = corners.length === 3 ? [a3, b3, c2, b3] : [a3, b3, c2, d2];
    if (w3 < 0) [ul, ur2, lr2, ll] = [ur2, ul, ll, lr2];
    if (h2 < 0) [ul, ur2, lr2, ll] = [ll, lr2, ur2, ul];
    return [+x3, +y2, +w3, +h2, ...ul, ...ur2, ...lr2, ...ll];
  }
  __name(getRoundRect, "getRoundRect");
  function getContextAttributes(options) {
    const {
      alpha = true,
      colorSpace = "srgb",
      desynchronized = false,
      willReadFrequently = false
    } = isObject(options) ? options : {};
    if (colorSpace !== "srgb" && colorSpace !== "display-p3") {
      throw new TypeError(`Invalid color space: '${colorSpace}'.`);
    }
    return {
      alpha: !!alpha,
      colorSpace,
      desynchronized: !!desynchronized,
      willReadFrequently: !!willReadFrequently
    };
  }
  __name(getContextAttributes, "getContextAttributes");
  function getFinite(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
      throw new TypeError(`Invalid number: '${value}'.`);
    }
    return number;
  }
  __name(getFinite, "getFinite");
  function getLong(value) {
    return getInteger(value, -(2 ** 31), 2 ** 31 - 1);
  }
  __name(getLong, "getLong");
  function getInteger(value, min, max) {
    const number = Math.trunc(Number(value));
    if (!(number >= min && number <= max)) {
      throw new TypeError(`Invalid integer: '${value}'.`);
    }
    return number;
  }
  __name(getInteger, "getInteger");
  function getSide(value) {
    const side = getInteger(value, 0, 2 ** 32 - 1);
    if (side === 0) {
      throw new DOMException(
        `Invalid ImageData size: '${value}'.`,
        "IndexSizeError"
      );
    }
    return side;
  }
  __name(getSide, "getSide");

  // src/dom.js
  var view;
  var dom = {
    get window() {
      return view ??= natives.dom();
    },
    get document() {
      return (view ??= natives.dom()).document;
    }
  };

  // src/clipboard.js
  var Clipboard = class extends EventTarget {
    static {
      __name(this, "Clipboard");
    }
    async readText() {
      return ask({ type: "clipboardRead" })?.text ?? "";
    }
    async writeText(text) {
      checkArguments(arguments, 1, "writeText");
      ask({ type: "clipboardWrite", text: String(text) });
    }
  };
  setToStringTag(Clipboard);
  function ask(question) {
    try {
      return natives.ask(question);
    } catch (err) {
      throw new DOMException(
        `Unable to use the clipboard: ${err.message}`,
        "NotAllowedError"
      );
    }
  }
  __name(ask, "ask");

  // src/compression.js
  function createTransform(format2, decompress) {
    const number = natives.compression.open(String(format2), decompress);
    return new TransformStream({
      transform(chunk, controller) {
        try {
          const buffer = ArrayBuffer.isView(chunk) ? chunk.buffer : chunk;
          if (!(buffer instanceof ArrayBuffer)) {
            throw new TypeError(`Invalid chunk: '${chunk}', not a buffer.`);
          }
          const [bytes, failure] = natives.compression.write(number, chunk);
          if (bytes.length) controller.enqueue(bytes);
          if (failure) throw new TypeError(failure);
        } catch (err) {
          natives.compression.close(number);
          throw err;
        }
      },
      flush(controller) {
        const bytes = natives.compression.finish(number);
        if (bytes.length) controller.enqueue(bytes);
      },
      cancel() {
        natives.compression.close(number);
      }
    });
  }
  __name(createTransform, "createTransform");
  var CompressionStream = class {
    static {
      __name(this, "CompressionStream");
    }
    #transform;
    constructor(format2) {
      this.#transform = createTransform(format2, false);
    }
    get readable() {
      return this.#transform.readable;
    }
    get writable() {
      return this.#transform.writable;
    }
  };
  var DecompressionStream = class {
    static {
      __name(this, "DecompressionStream");
    }
    #transform;
    constructor(format2) {
      this.#transform = createTransform(format2, true);
    }
    get readable() {
      return this.#transform.readable;
    }
    get writable() {
      return this.#transform.writable;
    }
  };
  setToStringTag(CompressionStream, DecompressionStream);

  // src/console.js
  var maxDepth = 2;
  var maxItems = 100;
  function createConsole(print2) {
    let indent = 0;
    const counts = /* @__PURE__ */ new Map();
    const timers = /* @__PURE__ */ new Map();
    const write = /* @__PURE__ */ __name((text) => print2(
      text.split("\n").map((line) => "  ".repeat(indent) + line).join("\n")
    ), "write");
    const log = /* @__PURE__ */ __name((...args) => write(format(args)), "log");
    const now = /* @__PURE__ */ __name(() => globalThis.performance?.now() ?? Date.now(), "now");
    const timeLog = /* @__PURE__ */ __name((end, label = "default", ...data) => {
      label = String(label);
      if (timers.has(label)) {
        let line = `${label}: ${(now() - timers.get(label)).toFixed(3)} ms`;
        if (end) timers.delete(label);
        else if (data.length) line += ` ${format(data)}`;
        write(line);
      } else {
        write(`Timer '${label}' does not exist`);
      }
    }, "timeLog");
    const group = /* @__PURE__ */ __name((...args) => {
      if (args.length) log(...args);
      indent++;
    }, "group");
    return {
      log,
      info: log,
      warn: log,
      error: log,
      debug: log,
      dirxml: log,
      // The value as an object, strings quoted.
      dir(value) {
        write(inspect(value, 1));
      },
      // The line, then where it was called from.
      trace(...args) {
        const line = format(args);
        const stack = (new Error().stack ?? "").split("\n").slice(1).map((line2) => line2.trim()).join("\n");
        write((line ? `Trace: ${line}` : "Trace") + (stack ? `
${stack}` : ""));
      },
      assert(condition, ...data) {
        if (!condition) {
          write(
            data.length ? `Assertion failed: ${format(data)}` : "Assertion failed"
          );
        }
      },
      count(label = "default") {
        label = String(label);
        const count = (counts.get(label) ?? 0) + 1;
        counts.set(label, count);
        write(`${label}: ${count}`);
      },
      countReset(label = "default") {
        label = String(label);
        if (counts.has(label)) {
          counts.set(label, 0);
        } else {
          write(`Count for '${label}' does not exist`);
        }
      },
      time(label = "default") {
        label = String(label);
        if (timers.has(label)) {
          write(`Timer '${label}' already exists`);
        } else {
          timers.set(label, now());
        }
      },
      timeLog(label, ...data) {
        timeLog(false, label, ...data);
      },
      timeEnd(label) {
        timeLog(true, label);
      },
      group,
      groupCollapsed: group,
      groupEnd() {
        indent = Math.max(0, indent - 1);
      },
      // An array's or object's items as rows, their properties as columns.
      table(data, columns) {
        if (data && typeof data === "object") {
          write(formatTable(data, columns));
        } else {
          log(data);
        }
      },
      clear() {
      }
    };
  }
  __name(createConsole, "createConsole");
  function format(args) {
    const parts2 = [];
    let rest = args;
    const [first, ...after] = args;
    if (typeof first === "string" && first.includes("%")) {
      rest = after;
      parts2.push(
        first.replace(/%([sdifoOc%])/g, (match, directive) => {
          if (directive === "%") return "%";
          if (!rest.length) return match;
          const value = rest.shift();
          switch (directive) {
            case "s":
              return inspect(value, 0);
            case "d":
            case "i": {
              const number = Number(value);
              return String(Number.isFinite(number) ? Math.trunc(number) : number);
            }
            case "f":
              return String(Number(value));
            case "o":
            case "O":
              return inspect(value, 1);
            default:
              return "";
          }
        })
      );
    }
    for (const value of rest) parts2.push(inspect(value, 0));
    return parts2.join(" ");
  }
  __name(format, "format");
  function inspect(value, depth) {
    if (typeof value === "string") {
      return depth === 0 ? value : `'${value}'`;
    }
    if (value === null || typeof value !== "object" && typeof value !== "function") {
      return String(value);
    }
    const tag = Object.prototype.toString.call(value);
    if (tag === "[object Array]") {
      return depth > maxDepth ? "[Array]" : `[${getItems(
        Array.from({ length: Math.min(value.length, maxItems) }, (_3, i2) => [
          i2,
          value[i2]
        ]),
        value.length,
        (_3, item) => inspect(item, depth + 1)
      )}]`;
    } else if (/^\[object (Async|Generator)?Function\]$/.test(tag)) {
      return `\u0192 ${value.name}()`;
    } else if (tag === "[object Error]") {
      return formatError(value);
    } else {
      const written = String(value);
      if (!written.startsWith("[object ")) {
        return written;
      } else if (depth > maxDepth) {
        return "{\u2026}";
      } else {
        const name = value.constructor?.name;
        const prefix = name && name !== "Object" ? `${name} ` : "";
        const keys = Object.keys(value);
        const members = getItems(
          keys.slice(0, maxItems).map((key) => [key, value[key]]),
          keys.length,
          (key, member) => `${key}: ${inspect(member, depth + 1)}`
        );
        return `${prefix}{${members}}`;
      }
    }
  }
  __name(inspect, "inspect");
  function getItems(entries, total, write) {
    const written = entries.map(([key, value]) => write(key, value));
    if (total > entries.length) {
      written.push(`\u2026 ${total - entries.length} more`);
    }
    return written.join(", ");
  }
  __name(getItems, "getItems");
  function formatTable(data, chosen) {
    let columns = [];
    const rows = Object.keys(data).slice(0, maxItems).map((key) => {
      const row = data[key];
      if (row !== null && typeof row === "object") {
        const cells = {};
        for (const column of Object.keys(row).slice(0, maxItems)) {
          cells[column] = inspect(row[column], 1);
          if (!columns.includes(column)) columns.push(column);
        }
        return { key, cells };
      } else {
        return { key, cells: {}, value: inspect(row, 1) };
      }
    });
    if (chosen && typeof chosen === "object") {
      columns = Array.from(chosen, String);
    }
    const hasValues = rows.some((row) => "value" in row);
    const grid = [
      ["(index)", ...columns, ...hasValues ? ["Value"] : []],
      ...rows.map(({ key, cells, value }) => [
        key,
        ...columns.map((column) => cells[column] ?? ""),
        ...hasValues ? [value ?? ""] : []
      ])
    ];
    const widths = grid[0].map(
      (_3, i2) => Math.max(...grid.map((row) => [...row[i2]].length))
    );
    return grid.map(
      (row) => `\u2502 ${row.map((cell, i2) => cell + " ".repeat(widths[i2] - [...cell].length)).join(" \u2502 ")} \u2502`
    ).join("\n");
  }
  __name(formatTable, "formatTable");

  // src/crypto.js
  var integerArrays = [
    Int8Array,
    Uint8Array,
    Uint8ClampedArray,
    Int16Array,
    Uint16Array,
    Int32Array,
    Uint32Array,
    BigInt64Array,
    BigUint64Array
  ];
  var Crypto = class {
    static {
      __name(this, "Crypto");
    }
    // At most 65536 bytes, as in browsers.
    getRandomValues(array) {
      if (!integerArrays.some((Class) => array instanceof Class)) {
        throw new DOMException(
          `Invalid array: '${array}', not an integer typed array.`,
          "TypeMismatchError"
        );
      }
      if (array.byteLength > 65536) {
        throw new DOMException(
          "Invalid array: more than 65536 bytes.",
          "QuotaExceededError"
        );
      }
      new Uint8Array(array.buffer, array.byteOffset, array.byteLength).set(
        natives.random(array.byteLength)
      );
      return array;
    }
    // A random version 4 UUID.
    randomUUID() {
      const bytes = natives.random(16);
      bytes[6] = bytes[6] & 15 | 64;
      bytes[8] = bytes[8] & 63 | 128;
      const hex = Array.from(
        bytes,
        (byte) => byte.toString(16).padStart(2, "0")
      ).join("");
      return [
        hex.slice(0, 8),
        hex.slice(8, 12),
        hex.slice(12, 16),
        hex.slice(16, 20),
        hex.slice(20)
      ].join("-");
    }
  };
  setToStringTag(Crypto);

  // src/dialog.js
  var defaultTitle = "Scriptographer";
  function setupDialog(Dialog) {
    Dialog.alert ??= function(...args) {
      natives.ask({ type: "alert", ...getTexts(args) });
    };
    Dialog.confirm ??= function(...args) {
      return natives.ask({ type: "confirm", ...getTexts(args) }) === true;
    };
    Object.assign(Dialog, {
      // The values by name, put into `values` when given, or `null` when the
      // user cancels.
      prompt(title = defaultTitle, components, values) {
        if (!components || typeof components !== "object") {
          throw new TypeError("Invalid components: they must be an object.");
        }
        const list = getComponents(components, values);
        return then(
          natives.ask({ type: "prompt", title: String(title), components: list }),
          (answer) => getValues2(list, answer, values)
        );
      },
      // A prompt with one colour: the colour picked, or `null`.
      chooseColor(color) {
        const component = { type: "color" };
        if (color != null) component.value = color;
        return then(
          Dialog.prompt(defaultTitle, { color: component }),
          (values) => values && values.color
        );
      },
      // Each gives a `LocalFile`, or `null` when the user cancels.
      async openFile(options) {
        const handles = await pick(
          showOpenFilePicker,
          getPickerOptions("openFile", options)
        );
        return handles && LocalFile.from(handles[0]);
      },
      async openFiles(options) {
        const handles = await pick(showOpenFilePicker, {
          ...getPickerOptions("openFile", options),
          multiple: true
        });
        return handles && Promise.all(handles.map((handle) => LocalFile.from(handle)));
      },
      async saveFile(options) {
        const handle = await pick(
          showSaveFilePicker,
          getPickerOptions("saveFile", options)
        );
        return handle && LocalFile.from(handle);
      },
      async chooseDirectory(options) {
        const handle = await pick(
          showDirectoryPicker,
          getPickerOptions("chooseDirectory", options)
        );
        return handle && LocalFile.from(handle);
      }
    });
  }
  __name(setupDialog, "setupDialog");
  function getComponents(components, values) {
    return Object.keys(components).map((name) => {
      const definition = components[name];
      const component = { name, ...toJSON(definition) };
      delete component.value;
      let value = values?.[name] !== void 0 ? values[name] : definition.value;
      if (typeof value?.toCSS === "function") {
        value = value.toCSS(true);
      }
      component.value = toJSON(value);
      component.type ??= // As Scriptographer read it from the definition:
      "options" in component ? "list" : typeof definition.onClick === "function" ? "button" : typeof definition.onSelect === "function" ? "menu-entry" : typeof component.value === "number" ? "number" : typeof component.value === "boolean" ? "boolean" : "string";
      if (component.type === "number" && typeof component.units === "string" && component.units !== "none") {
        component.steppers ??= true;
      }
      return component;
    });
  }
  __name(getComponents, "getComponents");
  function getValue(component, value) {
    return component.type === "color" && typeof value === "string" ? new paper.Color(value) : value;
  }
  __name(getValue, "getValue");
  function getValues2(list, answer, values) {
    if (answer && typeof answer === "object") {
      const result = values ?? {};
      for (const component of list) {
        if (component.name in answer) {
          result[component.name] = getValue(component, answer[component.name]);
        }
      }
      return result;
    } else {
      return null;
    }
  }
  __name(getValues2, "getValues");
  function getTexts(args) {
    const [title, message] = args.length > 1 ? args : [defaultTitle, args[0] ?? ""];
    return { title: String(title), message: String(message) };
  }
  __name(getTexts, "getTexts");
  function toJSON(value) {
    return JSON.parse(JSON.stringify(value ?? null) ?? "null");
  }
  __name(toJSON, "toJSON");
  function then(value, f2) {
    return value instanceof Promise ? value.then(f2) : f2(value);
  }
  __name(then, "then");
  async function pick(picker, options) {
    try {
      return await picker(options);
    } catch (err) {
      if (err.name === "AbortError") return null;
      throw err;
    }
  }
  __name(pick, "pick");
  function getPickerOptions(kind, { types: types2, path } = {}) {
    const options = {};
    if (types2 && kind !== "chooseDirectory") {
      const accepted = [];
      let acceptsAll = false;
      for (const [description, extensions] of getTypes(types2)) {
        if (extensions.length) {
          accepted.push({
            description,
            accept: {
              "application/octet-stream": extensions.map((ext) => `.${ext}`)
            }
          });
        } else {
          acceptsAll = true;
        }
      }
      options.types = accepted;
      options.excludeAcceptAllOption = !acceptsAll;
    }
    if (path != null) {
      const file = path instanceof LocalFile ? path : getLocalFile(path);
      if (file?.path) {
        options.startIn = file.isDirectory ? file : file.parent;
        if (kind === "saveFile" && !file.isDirectory) {
          options.suggestedName = file.name;
        }
      } else if (kind === "saveFile") {
        options.suggestedName = String(path).split(/[\\/]/).pop();
      }
    }
    return options;
  }
  __name(getPickerOptions, "getPickerOptions");
  function getTypes(types2) {
    const entries = Array.isArray(types2) ? Array.from({ length: Math.ceil(types2.length / 2) }, (_3, i2) => [
      types2[i2 * 2],
      types2[i2 * 2 + 1] ?? types2[i2 * 2]
    ]) : Object.entries(types2);
    return entries.map(([label, patterns]) => [
      String(label),
      (Array.isArray(patterns) ? patterns : String(patterns).split(";")).map(
        (pattern) => String(pattern).trim().replace(/^\*?\.?/, "")
      ).filter((ext) => ext && ext !== "*")
    ]);
  }
  __name(getTypes, "getTypes");
  function getLocalFile(path) {
    try {
      return new LocalFile(String(path));
    } catch {
      return null;
    }
  }
  __name(getLocalFile, "getLocalFile");

  // src/dom-exception.js
  var constants = [
    ["IndexSizeError", "INDEX_SIZE_ERR"],
    ["DOMStringSizeError", "DOMSTRING_SIZE_ERR"],
    ["HierarchyRequestError", "HIERARCHY_REQUEST_ERR"],
    ["WrongDocumentError", "WRONG_DOCUMENT_ERR"],
    ["InvalidCharacterError", "INVALID_CHARACTER_ERR"],
    ["NoDataAllowedError", "NO_DATA_ALLOWED_ERR"],
    ["NoModificationAllowedError", "NO_MODIFICATION_ALLOWED_ERR"],
    ["NotFoundError", "NOT_FOUND_ERR"],
    ["NotSupportedError", "NOT_SUPPORTED_ERR"],
    ["InUseAttributeError", "INUSE_ATTRIBUTE_ERR"],
    ["InvalidStateError", "INVALID_STATE_ERR"],
    ["SyntaxError", "SYNTAX_ERR"],
    ["InvalidModificationError", "INVALID_MODIFICATION_ERR"],
    ["NamespaceError", "NAMESPACE_ERR"],
    ["InvalidAccessError", "INVALID_ACCESS_ERR"],
    ["ValidationError", "VALIDATION_ERR"],
    ["TypeMismatchError", "TYPE_MISMATCH_ERR"],
    ["SecurityError", "SECURITY_ERR"],
    ["NetworkError", "NETWORK_ERR"],
    ["AbortError", "ABORT_ERR"],
    ["URLMismatchError", "URL_MISMATCH_ERR"],
    ["QuotaExceededError", "QUOTA_EXCEEDED_ERR"],
    ["TimeoutError", "TIMEOUT_ERR"],
    ["InvalidNodeTypeError", "INVALID_NODE_TYPE_ERR"],
    ["DataCloneError", "DATA_CLONE_ERR"]
  ];
  var codes = new Map(constants.map(([name], index) => [name, index + 1]));
  var DOMException2 = class extends Error {
    static {
      __name(this, "DOMException");
    }
    #name;
    constructor(message = "", name = "Error") {
      super(message);
      this.#name = String(name);
    }
    get name() {
      return this.#name;
    }
    get code() {
      return codes.get(this.#name) ?? 0;
    }
  };
  defineConstants(
    DOMException2,
    Object.fromEntries(
      constants.map(([, constant], index) => [constant, index + 1])
    )
  );
  setToStringTag(DOMException2);

  // src/encoding.js
  var TextEncoder2 = class {
    static {
      __name(this, "TextEncoder");
    }
    encode(text = "") {
      return natives.encoding.encode(String(text));
    }
    // As much of `text` as fits in `bytes`, whole characters only.
    encodeInto(text, bytes) {
      text = String(text);
      let read = 0;
      let written = 0;
      for (const char of text) {
        const point = char.codePointAt(0);
        const length = point < 128 ? 1 : point < 2048 ? 2 : point < 65536 ? 3 : 4;
        if (written + length > bytes.length) break;
        read += char.length;
        written += length;
      }
      bytes.set(natives.encoding.encode(text.slice(0, read)));
      return { read, written };
    }
  };
  var labels = ["utf-8", "utf8", "unicode-1-1-utf-8", "unicode11utf8"];
  var TextDecoder2 = class {
    static {
      __name(this, "TextDecoder");
    }
    #fatal;
    #ignoreBOM;
    // The bytes of a character a streamed chunk ended in the middle of, and
    // whether the stream is yet to start:
    #pending = new Uint8Array();
    #isStart = true;
    constructor(label = "utf-8", { fatal = false, ignoreBOM = false } = {}) {
      label = String(label).trim().toLowerCase();
      if (!labels.includes(label)) {
        throw new RangeError(`Unsupported encoding: '${label}', only UTF-8.`);
      }
      this.#fatal = !!fatal;
      this.#ignoreBOM = !!ignoreBOM;
    }
    get fatal() {
      return this.#fatal;
    }
    get ignoreBOM() {
      return this.#ignoreBOM;
    }
    // A buffer's or a view's bytes as text: invalid sequences replaced, or a
    // `TypeError` when the decoder is `fatal`.
    decode(input = new Uint8Array(), { stream = false } = {}) {
      const given = getBufferBytes(input) ?? new Uint8Array(input);
      let bytes = given;
      if (this.#pending.length) {
        bytes = new Uint8Array(this.#pending.length + given.length);
        bytes.set(this.#pending);
        bytes.set(given, this.#pending.length);
      }
      const end = stream ? bytes.length - getIncomplete(bytes) : bytes.length;
      this.#pending = bytes.slice(end);
      let text = natives.encoding.decode(bytes.subarray(0, end), this.#fatal);
      if (text === null) {
        throw new TypeError("Invalid UTF-8: the data is not valid UTF-8.");
      }
      if (this.#isStart && !this.#ignoreBOM && text.startsWith("\uFEFF")) {
        text = text.slice(1);
      }
      this.#isStart = !stream || this.#isStart && !text;
      return text;
    }
  };
  for (const target of [TextEncoder2.prototype, TextDecoder2.prototype]) {
    inject(
      target,
      {
        get encoding() {
          return "utf-8";
        }
      },
      { enumerable: true }
    );
  }
  var TextEncoderStream = class {
    static {
      __name(this, "TextEncoderStream");
    }
    #transform;
    constructor() {
      const encoder = new TextEncoder2();
      let pending = "";
      this.#transform = new TransformStream({
        transform(chunk, controller) {
          let text = pending + String(chunk);
          pending = /[\ud800-\udbff]$/.test(text) ? text.slice(-1) : "";
          if (pending) text = text.slice(0, -1);
          if (text) controller.enqueue(encoder.encode(text));
        },
        flush(controller) {
          if (pending) controller.enqueue(encoder.encode(pending));
        }
      });
    }
    get readable() {
      return this.#transform.readable;
    }
    get writable() {
      return this.#transform.writable;
    }
  };
  var TextDecoderStream = class {
    static {
      __name(this, "TextDecoderStream");
    }
    #decoder;
    #transform;
    constructor(label, options) {
      const decoder = this.#decoder = new TextDecoder2(label, options);
      this.#transform = new TransformStream({
        transform(chunk, controller) {
          if (!getBufferBytes(chunk)) {
            throw new TypeError(`Invalid chunk: '${chunk}', not a buffer.`);
          }
          const text = decoder.decode(chunk, { stream: true });
          if (text) controller.enqueue(text);
        },
        flush(controller) {
          const text = decoder.decode();
          if (text) controller.enqueue(text);
        }
      });
    }
    get fatal() {
      return this.#decoder.fatal;
    }
    get ignoreBOM() {
      return this.#decoder.ignoreBOM;
    }
    get readable() {
      return this.#transform.readable;
    }
    get writable() {
      return this.#transform.writable;
    }
  };
  for (const target of [
    TextEncoderStream.prototype,
    TextDecoderStream.prototype
  ]) {
    inject(
      target,
      {
        get encoding() {
          return "utf-8";
        }
      },
      { enumerable: true }
    );
  }
  setToStringTag(TextEncoder2, TextDecoder2, TextEncoderStream, TextDecoderStream);
  function getIncomplete(bytes) {
    for (let back = 1; back <= Math.min(3, bytes.length); back++) {
      const byte = bytes[bytes.length - back];
      if (byte >= 192) {
        const length = byte >= 240 ? 4 : byte >= 224 ? 3 : 2;
        return length > back ? back : 0;
      } else if (byte < 128) {
        return 0;
      }
    }
    return 0;
  }
  __name(getIncomplete, "getIncomplete");

  // src/event-source.js
  var states2 = { CONNECTING: 0, OPEN: 1, CLOSED: 2 };
  var EventSource = class extends EventTarget {
    static {
      __name(this, "EventSource");
    }
    #url;
    #withCredentials;
    #origin = "";
    #readyState = states2.CONNECTING;
    // `null` once the connection is closed:
    #number;
    constructor(url, { withCredentials = false } = {}) {
      checkArguments(arguments, 1, "EventSource");
      super();
      try {
        this.#url = new URL(url).href;
      } catch {
        throw new DOMException(`Invalid URL: '${url}'.`, "SyntaxError");
      }
      this.#withCredentials = !!withCredentials;
      this.#number = natives.eventSource.open(
        this.#url,
        (received) => this.#receive(received)
      );
    }
    get url() {
      return this.#url;
    }
    get withCredentials() {
      return this.#withCredentials;
    }
    get readyState() {
      return this.#readyState;
    }
    close() {
      if (this.#number !== null) {
        natives.eventSource.close(this.#number);
        this.#number = null;
      }
      this.#readyState = states2.CLOSED;
    }
    // What the runtime read: `{ state, … }`, `state` one of 'open', 'event',
    // 'reconnecting' and 'failed'.
    #receive({ state, url, type, data, lastEventId }) {
      if (state === "open") {
        this.#readyState = states2.OPEN;
        this.#origin = new URL(url).origin;
        fire(this, new Event("open"));
      } else if (state === "event") {
        const origin = this.#origin;
        fire(this, new MessageEvent(type, { data, lastEventId, origin }));
      } else {
        this.#readyState = state === "reconnecting" ? states2.CONNECTING : states2.CLOSED;
        if (state === "failed") this.#number = null;
        fire(this, new Event("error"));
      }
    }
  };
  defineConstants(EventSource, states2);
  defineEventHandlers(EventSource.prototype, "open", "message", "error");
  setToStringTag(EventSource);

  // src/fetch.js
  var fetch_exports = {};
  __export(fetch_exports, {
    FormData: () => FormData,
    Headers: () => Headers2,
    Request: () => Request,
    Response: () => Response,
    fetch: () => fetch2,
    getBody: () => getBody
  });

  // src/pairs.js
  var pairIterable = {
    forEach(callback, thisArg) {
      for (const [key, value] of this.entries()) {
        callback.call(thisArg, value, key, this);
      }
    },
    *keys() {
      for (const [key] of this.entries()) yield key;
    },
    *values() {
      for (const [, value] of this.entries()) yield value;
    },
    [Symbol.iterator]() {
      return this.entries();
    }
  };
  function getPairs(init) {
    return typeof init[Symbol.iterator] === "function" ? Array.from(init, (pair) => {
      pair = [...pair];
      if (pair.length !== 2) {
        throw new TypeError(`Invalid pair: '${pair}'.`);
      }
      return pair;
    }) : Object.entries(init);
  }
  __name(getPairs, "getPairs");
  function setFirst(list, entry) {
    const index = list.findIndex(([name]) => name === entry[0]);
    const rest = list.filter(([name]) => name !== entry[0]);
    rest.splice(index < 0 ? rest.length : index, 0, entry);
    return rest;
  }
  __name(setFirst, "setFirst");

  // src/fetch.js
  var Headers2 = class _Headers {
    static {
      __name(this, "Headers");
    }
    // The headers as they came, names in lower case:
    #list = [];
    constructor(init) {
      if (init instanceof _Headers) {
        this.#list = [...init.#list];
      } else if (init != null) {
        for (const [name, value] of getPairs(init)) this.append(name, value);
      }
    }
    get(name) {
      const values = this.#getValues(name);
      return values.length ? values.join(", ") : null;
    }
    getSetCookie() {
      return this.#getValues("set-cookie");
    }
    has(name) {
      return this.#getValues(name).length > 0;
    }
    set(name, value) {
      this.#list = setFirst(this.#list, getHeader(name, value));
    }
    append(name, value) {
      this.#list.push(getHeader(name, value));
    }
    delete(name) {
      name = getName(name);
      this.#list = this.#list.filter((header) => header[0] !== name);
    }
    // As scripts see them: sorted by name, the values of a name joined.
    *entries() {
      const names2 = [...new Set(this.#list.map(([name]) => name))].sort();
      for (const name of names2) yield [name, this.get(name)];
    }
    #getValues(name) {
      name = getName(name);
      return this.#list.filter((header) => header[0] === name).map(([, value]) => value);
    }
  };
  var FormData = class {
    static {
      __name(this, "FormData");
    }
    // `[name, value]`, a value a string or a `File`:
    #entries = [];
    append(name, value, filename) {
      checkArguments(arguments, 2, "append");
      this.#entries.push(getEntry(...arguments));
    }
    set(name, value, filename) {
      checkArguments(arguments, 2, "set");
      this.#entries = setFirst(this.#entries, getEntry(...arguments));
    }
    get(name) {
      return this.#entries.find((entry) => entry[0] === String(name))?.[1] ?? null;
    }
    getAll(name) {
      return this.#entries.filter((entry) => entry[0] === String(name)).map(([, value]) => value);
    }
    has(name) {
      return this.#entries.some((entry) => entry[0] === String(name));
    }
    delete(name) {
      this.#entries = this.#entries.filter((entry) => entry[0] !== String(name));
    }
    *entries() {
      for (const [name, value] of this.#entries) yield [name, value];
    }
  };
  for (const Class of [Headers2, FormData]) {
    inject(Class.prototype, pairIterable);
  }
  var Body = class {
    static {
      __name(this, "Body");
    }
    #bytes = null;
    #stream = null;
    #isUsed = false;
    // The body's bytes, or the stream it is, its type in `headers` unless they
    // have one.
    constructor(body, headers) {
      if (body instanceof ReadableStream) {
        this.#stream = body;
      } else if (body != null) {
        const { bytes, type } = getBody(body);
        if (type && !headers.has("content-type")) {
          headers.set("content-type", type);
        }
        this.#bytes = bytes;
      }
    }
    get body() {
      if (!this.#stream && this.#bytes) {
        const bytes = this.#bytes;
        this.#stream = new ReadableStream({
          type: "bytes",
          pull(controller) {
            if (bytes.length) controller.enqueue(bytes.slice());
            controller.close();
          }
        });
      }
      return this.#stream;
    }
    // Read once its stream was read from, as web-streams-polyfill marks it:
    get bodyUsed() {
      return this.#isUsed || !!this.#stream?._disturbed;
    }
    async text() {
      return new TextDecoder().decode(await this.#take());
    }
    async json() {
      return JSON.parse(await this.text());
    }
    async arrayBuffer() {
      return (await this.#take()).slice().buffer;
    }
    async bytes() {
      return (await this.#take()).slice();
    }
    async blob() {
      const type = this.headers.get("content-type") ?? "";
      return new Blob([await this.#take()], { type });
    }
    async #take() {
      if (this.bodyUsed || this.#stream?.locked) {
        throw new TypeError("Unable to read the body: it was read already.");
      }
      this.#isUsed = true;
      return this.#stream ? readStream(this.#stream) : this.#bytes ?? new Uint8Array();
    }
    // The body, unread, for a copy: its bytes, or a branch of its stream, which
    // keeps the other.
    static copy(body) {
      if (body.bodyUsed || body.#stream?.locked) {
        throw new TypeError("Unable to copy the body: it was read already.");
      }
      if (body.#stream) {
        const [kept, copied] = body.#stream.tee();
        body.#stream = kept;
        return copied;
      }
      return body.#bytes;
    }
    // The body's bytes, to send, or `null` without a body.
    static async read(body) {
      return body.#stream || body.#bytes ? body.#take() : null;
    }
  };
  var Request = class _Request extends Body {
    static {
      __name(this, "Request");
    }
    #url;
    #method;
    #headers;
    #signal;
    #redirect;
    constructor(input, init = {}) {
      const from = input instanceof _Request ? input : null;
      const method = String(init.method ?? from?.method ?? "GET").toUpperCase();
      const headers = new Headers2(init.headers ?? from?.headers);
      const body = init.body ?? (from && Body.copy(from));
      if (body != null && (method === "GET" || method === "HEAD")) {
        throw new TypeError(`Invalid Request: a ${method} request has no body.`);
      }
      super(body, headers);
      this.#url = from ? from.url : String(input);
      this.#method = method;
      this.#headers = headers;
      this.#signal = init.signal ?? from?.signal ?? null;
      this.#redirect = String(init.redirect ?? from?.redirect ?? "follow");
    }
    get url() {
      return this.#url;
    }
    get method() {
      return this.#method;
    }
    get headers() {
      return this.#headers;
    }
    get signal() {
      return this.#signal;
    }
    get redirect() {
      return this.#redirect;
    }
    clone() {
      return new _Request(this);
    }
  };
  var setResponse;
  var Response = class _Response extends Body {
    static {
      __name(this, "Response");
    }
    #status;
    #statusText;
    #headers;
    #url = "";
    #redirected = false;
    #type = "default";
    constructor(body = null, { status = 200, statusText = "", headers } = {}) {
      status = Number(status);
      if (!(status >= 200 && status <= 599)) {
        throw new RangeError(`Invalid Response status: '${status}'.`);
      }
      headers = new Headers2(headers);
      super(body, headers);
      this.#status = status;
      this.#statusText = String(statusText);
      this.#headers = headers;
    }
    static {
      setResponse = /* @__PURE__ */ __name((response, { url, redirected, type }) => {
        response.#url = url;
        response.#redirected = redirected;
        response.#type = type;
        return response;
      }, "setResponse");
    }
    get status() {
      return this.#status;
    }
    get statusText() {
      return this.#statusText;
    }
    get ok() {
      return this.#status >= 200 && this.#status <= 299;
    }
    get headers() {
      return this.#headers;
    }
    get url() {
      return this.#url;
    }
    get redirected() {
      return this.#redirected;
    }
    get type() {
      return this.#type;
    }
    clone() {
      const { status, statusText, headers } = this;
      return setResponse(
        new _Response(Body.copy(this), { status, statusText, headers }),
        this
      );
    }
  };
  setToStringTag(Headers2, FormData, Request, Response);
  async function fetch2(input, init) {
    const request = new Request(input, init);
    const { method, url, headers, signal, redirect } = request;
    const body = await Body.read(request);
    signal?.throwIfAborted();
    return new Promise((resolve, reject) => {
      let controller;
      const stream = new ReadableStream({
        type: "bytes",
        start(c2) {
          controller = c2;
        },
        cancel() {
          finish();
        }
      });
      const receive = /* @__PURE__ */ __name((value) => {
        if (typeof value === "string") {
          const err = new TypeError(`fetch failed: ${value}`);
          reject(err);
          controller.error(err);
          finish();
        } else if (value instanceof Uint8Array) {
          controller.enqueue(value);
        } else if (value) {
          const { status, statusText, url: url2, redirected, headers: headers2 } = value;
          const response = new Response(stream, { status, statusText, headers: headers2 });
          resolve(setResponse(response, { url: url2, redirected, type: "basic" }));
        } else {
          controller.close();
          finish();
        }
      }, "receive");
      const number = natives.fetch.request(
        method,
        url,
        [...headers],
        body,
        redirect === "follow",
        receive
      );
      const finish = /* @__PURE__ */ __name(() => {
        natives.fetch.cancel(number);
        signal?.removeEventListener("abort", abort2);
      }, "finish");
      const abort2 = /* @__PURE__ */ __name(() => {
        reject(signal.reason);
        controller.error(signal.reason);
        finish();
      }, "abort");
      signal?.addEventListener("abort", abort2);
    });
  }
  __name(fetch2, "fetch");
  async function readStream(stream) {
    const chunks = [];
    for await (const chunk of stream) {
      if (!(chunk instanceof Uint8Array)) {
        throw new TypeError(`Invalid body chunk: '${chunk}', not a Uint8Array.`);
      }
      chunks.push(chunk);
    }
    const bytes = new Uint8Array(chunks.reduce((size, c2) => size + c2.length, 0));
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    return bytes;
  }
  __name(readStream, "readStream");
  function getBody(body) {
    const bytes = getBufferBytes(body);
    return bytes ? { bytes, type: null } : body instanceof Blob ? { bytes: getBytes(body), type: body.type || null } : body instanceof FormData ? getMultipart(body) : {
      bytes: new TextEncoder().encode(String(body)),
      type: body instanceof URLSearchParams ? "application/x-www-form-urlencoded;charset=UTF-8" : "text/plain;charset=UTF-8"
    };
  }
  __name(getBody, "getBody");
  function getHeader(name, value) {
    return [getName(name), String(value).replace(/^[\t\n\r ]+|[\t\n\r ]+$/g, "")];
  }
  __name(getHeader, "getHeader");
  function getName(name) {
    return String(name).trim().toLowerCase();
  }
  __name(getName, "getName");
  function getEntry(name, value, filename) {
    return [
      String(name),
      value instanceof Blob ? value instanceof File && filename === void 0 ? value : new File([value], filename ?? value.name ?? "blob", {
        type: value.type
      }) : String(value)
    ];
  }
  __name(getEntry, "getEntry");
  function getMultipart(form) {
    const boundary = `----Scriptographer${Array.from(
      { length: 24 },
      () => Math.floor(Math.random() * 16).toString(16)
    ).join("")}`;
    const quote = /* @__PURE__ */ __name((text) => text.replace(/\r/g, "%0D").replace(/\n/g, "%0A").replace(/"/g, "%22"), "quote");
    const parts2 = [];
    for (const [name, value] of form) {
      const disposition = `--${boundary}\r
Content-Disposition: form-data; name="${quote(name)}"`;
      if (value instanceof File) {
        const type = value.type || "application/octet-stream";
        parts2.push(
          `${disposition}; filename="${quote(value.name)}"\r
Content-Type: ${type}\r
\r
`,
          value,
          "\r\n"
        );
      } else {
        parts2.push(`${disposition}\r
\r
${value}\r
`);
      }
    }
    parts2.push(`--${boundary}--\r
`);
    return {
      bytes: getBytes(new Blob(parts2)),
      type: `multipart/form-data; boundary=${boundary}`
    };
  }
  __name(getMultipart, "getMultipart");

  // src/file-system.js
  var file_system_exports = {};
  __export(file_system_exports, {
    FileSystemDirectoryHandle: () => FileSystemDirectoryHandle,
    FileSystemFileHandle: () => FileSystemFileHandle,
    FileSystemHandle: () => FileSystemHandle,
    FileSystemWritableFileStream: () => FileSystemWritableFileStream,
    getDirectoryHandle: () => getDirectoryHandle,
    getHandlePath: () => getHandlePath,
    showDirectoryPicker: () => showDirectoryPicker2,
    showOpenFilePicker: () => showOpenFilePicker2,
    showSaveFilePicker: () => showSaveFilePicker2
  });

  // src/local-file.js
  var types = {
    txt: "text/plain",
    md: "text/markdown",
    csv: "text/csv",
    html: "text/html",
    css: "text/css",
    js: "text/javascript",
    json: "application/json",
    xml: "application/xml",
    pdf: "application/pdf",
    svg: "image/svg+xml",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    bmp: "image/bmp",
    tif: "image/tiff",
    tiff: "image/tiff"
  };
  var LocalFile2 = class _LocalFile extends File {
    static {
      __name(this, "LocalFile");
    }
    #path;
    constructor(...parts2) {
      if (!parts2.length) {
        throw new TypeError("Invalid LocalFile: its path is missing.");
      }
      const path = natives.fs.path(...parts2.map(String));
      super([], natives.fs.info(path).name);
      this.#path = path;
    }
    // The `LocalFile` of a file or directory handle.
    static async from(handle) {
      const path = getHandlePath(handle);
      if (!path) {
        throw new TypeError(
          `Invalid handle: '${handle}', not a FileSystemHandle.`
        );
      }
      return new _LocalFile(path);
    }
    get path() {
      return this.#path;
    }
    get name() {
      return this.#info.name;
    }
    get extension() {
      return this.#info.extension;
    }
    get type() {
      return getType2(this.#path);
    }
    get parent() {
      const { parent } = this.#info;
      return parent ? new _LocalFile(parent) : null;
    }
    get isDirectory() {
      return this.#info.isDirectory;
    }
    // On desktop, every file can be written where it is.
    get writable() {
      return true;
    }
    get size() {
      return this.#info.size;
    }
    get lastModified() {
      return this.#info.lastModified;
    }
    // What it holds now, as its readers read it:
    [readBytes]() {
      return natives.fs.read(this.#path);
    }
    // Text, a `Blob`, a buffer or a view.
    async write(data = "") {
      natives.fs.write(this.#path, getBody(data).bytes, false);
    }
    async append(data = "") {
      natives.fs.write(this.#path, getBody(data).bytes, true);
    }
    async exists() {
      return this.#info.exists;
    }
    // The files and directories in the directory, by name.
    async list() {
      return natives.fs.list(this.#path).map((path) => new _LocalFile(path));
    }
    // The file or directory `name` in this directory.
    async file(name) {
      return new _LocalFile(this.#path, String(name));
    }
    async makeDirectory() {
      natives.fs.makeDirectory(this.#path, true);
      return this;
    }
    // A name renames it where it is, a path moves it; the `LocalFile` follows.
    async rename(nameOrPath) {
      this.#path = natives.fs.rename(this.#path, String(nameOrPath));
      return this;
    }
    async copyTo(fileOrPath) {
      const copy = new _LocalFile(fileOrPath);
      natives.fs.copy(this.#path, copy.path);
      return copy;
    }
    // A directory with what's in it only when `recursive`.
    async remove({ recursive = false } = {}) {
      natives.fs.remove(this.#path, recursive);
    }
    toString() {
      return this.#path;
    }
    get #info() {
      return natives.fs.info(this.#path);
    }
  };
  setToStringTag(LocalFile2);
  function getType2(path) {
    return types[natives.fs.info(path).extension.toLowerCase()] ?? "";
  }
  __name(getType2, "getType");

  // src/file-system.js
  var pathsByHandle = /* @__PURE__ */ new WeakMap();
  var most = 512 * 1024 * 1024;
  var FileSystemHandle = class {
    static {
      __name(this, "FileSystemHandle");
    }
    constructor(key, path) {
      checkInternal(key, "FileSystemHandle", "the pickers give them");
      pathsByHandle.set(this, path);
    }
    get kind() {
      return this instanceof FileSystemDirectoryHandle ? "directory" : "file";
    }
    get name() {
      return natives.fs.info(getPath2(this)).name;
    }
    async isSameEntry(other) {
      return pathsByHandle.get(other) === getPath2(this);
    }
    // Granted: scripts on desktop may change what the user's files.
    async queryPermission() {
      return "granted";
    }
    async requestPermission() {
      return "granted";
    }
  };
  var FileSystemFileHandle = class extends FileSystemHandle {
    static {
      __name(this, "FileSystemFileHandle");
    }
    async getFile() {
      const path = getPath2(this);
      const { name, lastModified } = natives.fs.info(path);
      return new File([natives.fs.read(path)], name, {
        type: getType2(path),
        lastModified
      });
    }
    // A stream that writes the file on `close()`, starting empty, or with what
    // the file holds.
    async createWritable({ keepExistingData = false } = {}) {
      const path = getPath2(this);
      return new FileSystemWritableFileStream(
        internal,
        path,
        keepExistingData ? natives.fs.read(path) : new Uint8Array()
      );
    }
  };
  var FileSystemDirectoryHandle = class extends FileSystemHandle {
    static {
      __name(this, "FileSystemDirectoryHandle");
    }
    async getFileHandle(name, { create = false } = {}) {
      return getEntry2(this, name, false, create);
    }
    async getDirectoryHandle(name, { create = false } = {}) {
      return getEntry2(this, name, true, create);
    }
    async removeEntry(name, { recursive = false } = {}) {
      natives.fs.remove(getEntryPath(this, name), recursive);
    }
    // The names from the directory down to `handle`, or `null` outside it.
    async resolve(handle) {
      const path = pathsByHandle.get(handle);
      return path ? natives.fs.relative(getPath2(this), path) : null;
    }
    // What's in the directory, by name:
    async *entries() {
      for (const path of natives.fs.list(getPath2(this))) {
        yield [natives.fs.info(path).name, createHandle(path)];
      }
    }
    async *keys() {
      for await (const [name] of this.entries()) yield name;
    }
    async *values() {
      for await (const [, handle] of this.entries()) yield handle;
    }
    [Symbol.asyncIterator]() {
      return this.entries();
    }
  };
  var FileSystemWritableFileStream = class {
    static {
      __name(this, "FileSystemWritableFileStream");
    }
    #path;
    #bytes;
    #position = 0;
    #isClosed = false;
    constructor(key, path, bytes) {
      checkInternal(
        key,
        "FileSystemWritableFileStream",
        "createWritable() gives them"
      );
      this.#path = path;
      this.#bytes = bytes;
    }
    // Text, a `Blob`, a buffer or a view at the position, or
    // `{ type: 'write' | 'seek' | 'truncate', data, position, size }`.
    async write(data) {
      const isCommand = data && typeof data === "object" && typeof data.type === "string" && !(data instanceof Blob) && !getBufferBytes(data);
      const { type, position, size } = isCommand ? data : { type: "write" };
      if (type === "seek") {
        return this.seek(position);
      } else if (type === "truncate") {
        return this.truncate(size);
      } else if (type === "write") {
        if (isCommand) data = data.data;
        if (data == null) {
          throw new DOMException(
            "Invalid write(): the data is missing.",
            "SyntaxError"
          );
        }
        this.#check();
        const { bytes } = getBody(data);
        const start = getCount(position ?? this.#position);
        const end = getCount(start + bytes.length);
        if (this.#bytes.length < end) this.#resize(end);
        this.#bytes.set(bytes, start);
        this.#position = end;
      } else {
        throw new TypeError(`Invalid write() command: '${type}'.`);
      }
    }
    // Where the stream writes next.
    async seek(position) {
      if (position == null) {
        throw new DOMException(
          "Invalid seek(): the position is missing.",
          "SyntaxError"
        );
      }
      this.#check();
      this.#position = getCount(position);
    }
    // Its bytes cut, or filled with zeros, to `size`.
    async truncate(size) {
      this.#check();
      this.#resize(getCount(size));
      this.#position = Math.min(this.#position, this.#bytes.length);
    }
    // Write the file, all at once.
    async close() {
      this.#check();
      this.#isClosed = true;
      natives.fs.write(this.#path, this.#bytes, false);
    }
    async abort() {
      this.#check();
      this.#isClosed = true;
    }
    #check() {
      if (this.#isClosed) {
        throw new TypeError("Invalid stream: it is closed.");
      }
    }
    #resize(size) {
      const bytes = new Uint8Array(size);
      bytes.set(this.#bytes.subarray(0, size));
      this.#bytes = bytes;
    }
  };
  setToStringTag(
    FileSystemHandle,
    FileSystemFileHandle,
    FileSystemDirectoryHandle,
    FileSystemWritableFileStream
  );
  async function showOpenFilePicker2(options = {}) {
    const paths = pick2(options.multiple ? "openFiles" : "openFile", options);
    return paths.map((path) => createHandle(path, false));
  }
  __name(showOpenFilePicker2, "showOpenFilePicker");
  async function showSaveFilePicker2(options = {}) {
    const start = getStart(options);
    const { suggestedName } = options;
    const path = suggestedName == null ? start : start ? natives.fs.path(start, String(suggestedName)) : String(suggestedName);
    const [picked] = pick2("saveFile", options, path);
    if (!natives.fs.info(picked).exists) {
      natives.fs.write(picked, new Uint8Array(), false);
    }
    return createHandle(picked, false);
  }
  __name(showSaveFilePicker2, "showSaveFilePicker");
  async function showDirectoryPicker2(options = {}) {
    const [picked] = pick2("chooseDirectory", { startIn: options.startIn });
    return createHandle(picked, true);
  }
  __name(showDirectoryPicker2, "showDirectoryPicker");
  function getHandlePath(handle) {
    return pathsByHandle.get(handle) ?? null;
  }
  __name(getHandlePath, "getHandlePath");
  function getPath2(handle) {
    const path = pathsByHandle.get(handle);
    if (!path) {
      throw new TypeError(`Invalid handle: '${handle}', not a FileSystemHandle.`);
    }
    return path;
  }
  __name(getPath2, "getPath");
  function getDirectoryHandle(path) {
    return new FileSystemDirectoryHandle(internal, path);
  }
  __name(getDirectoryHandle, "getDirectoryHandle");
  function createHandle(path, isDirectory = natives.fs.info(path).isDirectory) {
    const Handle = isDirectory ? FileSystemDirectoryHandle : FileSystemFileHandle;
    return new Handle(internal, path);
  }
  __name(createHandle, "createHandle");
  function getEntryPath(directory, name) {
    name = String(name);
    if (!name || name === "." || name === ".." || /[/\\]/.test(name)) {
      throw new TypeError(`Invalid name: '${name}'.`);
    }
    return natives.fs.path(getPath2(directory), name);
  }
  __name(getEntryPath, "getEntryPath");
  function getEntry2(directory, name, isDirectory, create) {
    const path = getEntryPath(directory, name);
    const info = natives.fs.info(path);
    if (info.exists) {
      if (info.isDirectory !== isDirectory) {
        throw new DOMException(
          `Invalid entry: '${path}' is a ${info.isDirectory ? "directory" : "file"}.`,
          "TypeMismatchError"
        );
      }
    } else if (create) {
      if (isDirectory) {
        natives.fs.makeDirectory(path, false);
      } else {
        natives.fs.write(path, new Uint8Array(), false);
      }
    } else {
      throw new DOMException(`Unable to find '${path}'.`, "NotFoundError");
    }
    return createHandle(path, isDirectory);
  }
  __name(getEntry2, "getEntry");
  function getCount(value) {
    const count = Number(value);
    if (!(count >= 0 && Number.isFinite(count))) {
      throw new TypeError(`Invalid size: '${value}'.`);
    }
    if (count > most) {
      throw new DOMException(
        `Unable to write ${count} bytes: more than a file may have here.`,
        "QuotaExceededError"
      );
    }
    return Math.trunc(count);
  }
  __name(getCount, "getCount");
  function pick2(type, options, path = getStart(options)) {
    const answer = natives.ask({ type, path, filters: getFilters(options) });
    const paths = (Array.isArray(answer) ? answer : [answer]).filter(
      (path2) => typeof path2 === "string"
    );
    if (!paths.length) {
      throw new DOMException("The user aborted a request.", "AbortError");
    }
    return paths;
  }
  __name(pick2, "pick");
  function getStart({ startIn }) {
    if (startIn == null) {
      return null;
    } else if (typeof startIn === "object") {
      const path = getHandlePath(startIn) ?? startIn.path;
      if (typeof path !== "string") {
        throw new TypeError(
          `Invalid startIn: '${startIn}', not a handle or a LocalFile.`
        );
      }
      const info = natives.fs.info(path);
      return info.isDirectory ? path : info.parent;
    } else {
      return natives.fs.userDirectory(String(startIn));
    }
  }
  __name(getStart, "getStart");
  function getFilters({ types: types2, excludeAcceptAllOption }) {
    const filters = Array.from(types2 ?? [], ({ description, accept }) => {
      if (!accept) {
        throw new TypeError("Invalid file type: its accept is missing.");
      }
      const extensions = Object.values(accept).flat().map((extension) => {
        extension = String(extension);
        if (!/^\.[^.]/.test(extension)) {
          throw new TypeError(
            `Invalid extension: '${extension}', which starts with '.'.`
          );
        }
        return extension.slice(1);
      });
      return [
        description || extensions.map((extension) => `.${extension}`).join(", "),
        extensions
      ];
    });
    if (filters.length && !excludeAcceptAllOption) {
      filters.push(["All Files", []]);
    }
    return filters;
  }
  __name(getFilters, "getFilters");

  // src/rejections.js
  var reasonsByPromise = /* @__PURE__ */ new WeakMap();
  function notifyRejections(events) {
    const unhandled = /* @__PURE__ */ new Map();
    for (const [promise, handled, reason] of events) {
      if (!handled) {
        unhandled.set(promise, reason);
      } else if (!unhandled.delete(promise) && reasonsByPromise.has(promise)) {
        const reason2 = reasonsByPromise.get(promise);
        reasonsByPromise.delete(promise);
        fire(
          globalThis,
          new PromiseRejectionEvent("rejectionhandled", { promise, reason: reason2 })
        );
      }
    }
    for (const [promise, reason] of unhandled) {
      const event = new PromiseRejectionEvent("unhandledrejection", {
        promise,
        reason,
        cancelable: true
      });
      if (fire(globalThis, event)) report(reason);
      reasonsByPromise.set(promise, reason);
    }
  }
  __name(notifyRejections, "notifyRejections");
  function reportRejections() {
    globalThis.addEventListener("unhandledrejection", (event) => {
      setTimeout(() => {
        if (!event.defaultPrevented) report(event.reason);
      });
    });
  }
  __name(reportRejections, "reportRejections");
  function report(reason) {
    console.error(`Uncaught (in promise) ${formatError(reason)}`);
  }
  __name(report, "report");

  // src/font-face.js
  var defaults = {
    style: "normal",
    weight: "normal",
    stretch: "normal",
    unicodeRange: "U+0-10FFFF",
    featureSettings: "normal",
    variationSettings: "normal",
    display: "auto",
    ascentOverride: "normal",
    descentOverride: "normal",
    lineGapOverride: "normal"
  };
  var getFamilies;
  var FontFace = class {
    static {
      __name(this, "FontFace");
    }
    #family;
    #source;
    #status = "unloaded";
    // The font's families, as VectorCraft knows them, once it's loaded:
    #families = null;
    #loaded;
    #settle;
    constructor(family, source, descriptors = {}) {
      checkArguments(arguments, 2, "FontFace");
      this.#family = String(family);
      this.#source = source;
      this.#loaded = new Promise((resolve, reject) => {
        this.#settle = { resolve, reject };
      });
      this.#loaded.catch(() => {
      });
      for (const key of Object.keys(defaults)) {
        if (key in descriptors) {
          this[key] = descriptors[key];
        }
      }
      if (typeof source !== "string") {
        this.load();
      }
    }
    static {
      getFamilies = /* @__PURE__ */ __name((face) => face.#families, "getFamilies");
    }
    get family() {
      return this.#family;
    }
    set family(family) {
      this.#family = String(family);
    }
    get status() {
      return this.#status;
    }
    get loaded() {
      return this.#loaded;
    }
    load() {
      if (this.#status === "unloaded") {
        this.#status = "loading";
        getFontBytes(this.#source).then((bytes) => {
          const families = natives.canvas.addFont(bytes);
          if (!families.length) {
            throw new DOMException(
              `Invalid font: '${this.#family}' is no font file.`,
              "SyntaxError"
            );
          }
          this.#families = families;
          this.#status = "loaded";
          this.#settle.resolve(this);
        }).catch((err) => {
          this.#status = "error";
          this.#settle.reject(
            err instanceof DOMException ? err : new DOMException(
              `Unable to load font '${this.#family}': ${err.message}`,
              "NetworkError"
            )
          );
        });
      }
      return this.#loaded;
    }
  };
  for (const key of Object.keys(defaults)) {
    const values = /* @__PURE__ */ new WeakMap();
    inject(
      FontFace.prototype,
      {
        get [key]() {
          return values.get(this) ?? defaults[key];
        },
        set [key](value) {
          values.set(this, String(value));
        }
      },
      { enumerable: true }
    );
  }
  var FontFaceSet = class extends EventTarget {
    static {
      __name(this, "FontFaceSet");
    }
    #faces = /* @__PURE__ */ new Set();
    constructor(key) {
      checkInternal(key, "FontFaceSet", "scripts have one, fonts");
      super();
    }
    get size() {
      return this.#faces.size;
    }
    get status() {
      return [...this.#faces].some((face) => face.status === "loading") ? "loading" : "loaded";
    }
    // Once the faces that are loading now loaded or failed:
    get ready() {
      const loading = [...this.#faces].filter((face) => face.status === "loading");
      return Promise.allSettled(loading.map((face) => face.loaded)).then(
        () => this
      );
    }
    add(face) {
      checkFace(face);
      if (!this.#faces.has(face)) {
        this.#faces.add(face);
        face.loaded.then(
          () => {
            if (this.#faces.has(face)) {
              show(face, true);
            }
          },
          () => {
          }
        );
      }
      return this;
    }
    delete(face) {
      checkFace(face);
      const deleted = this.#faces.delete(face);
      if (deleted && face.status === "loaded") {
        show(face, false);
      }
      return deleted;
    }
    clear() {
      for (const face of [...this.#faces]) {
        this.delete(face);
      }
    }
    has(face) {
      return this.#faces.has(face);
    }
    forEach(callback, thisArg) {
      for (const face of this.#faces) {
        callback.call(thisArg, face, face, this);
      }
    }
    values() {
      return this.#faces.values();
    }
    keys() {
      return this.#faces.values();
    }
    entries() {
      return this.#faces.entries();
    }
    [Symbol.iterator]() {
      return this.#faces.values();
    }
    // The faces of the families in the CSS `font`, loaded:
    load(font, text = "") {
      return Promise.all(this.#matching(font).map((face) => face.load()));
    }
    // Whether the faces of the families in the CSS `font` are all loaded:
    check(font, text = "") {
      return this.#matching(font).every((face) => face.status === "loaded");
    }
    #matching(font) {
      const families = String(font).split(",").map(
        (family) => family.trim().split(/\s+/).pop().replace(/^['"]|['"]$/g, "")
      ).map((family) => family.toLowerCase());
      return [...this.#faces].filter(
        (face) => families.includes(face.family.toLowerCase())
      );
    }
  };
  setToStringTag(FontFace, FontFaceSet);
  function checkFace(face) {
    if (!(face instanceof FontFace)) {
      throw new TypeError(`Invalid font face: '${face}', not a FontFace.`);
    }
  }
  __name(checkFace, "checkFace");
  function show(face, shown) {
    natives.canvas.setFontFace(face.family, getFamilies(face), shown);
  }
  __name(show, "show");
  async function getFontBytes(source) {
    if (typeof source === "string") {
      const url = /url\(\s*(['"]?)(.*?)\1\s*\)/.exec(source)?.[2];
      if (!url) {
        throw new DOMException(
          `Invalid font source: '${source}'.`,
          "SyntaxError"
        );
      }
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`);
      }
      return new Uint8Array(await response.arrayBuffer());
    } else {
      const bytes = getBufferBytes(source);
      if (!bytes) {
        throw new TypeError(`Invalid font source: '${source}'.`);
      }
      return bytes;
    }
  }
  __name(getFontBytes, "getFontBytes");

  // src/locks.js
  var Lock = class {
    static {
      __name(this, "Lock");
    }
    #name;
    #mode;
    constructor(key, name, mode) {
      checkInternal(key, "Lock", "navigator.locks.request() gives them");
      this.#name = name;
      this.#mode = mode;
    }
    get name() {
      return this.#name;
    }
    get mode() {
      return this.#mode;
    }
  };
  var LockManager = class {
    static {
      __name(this, "LockManager");
    }
    constructor(key) {
      checkInternal(key, "LockManager", "navigator.locks is one");
    }
    // `request(name, [options,] callback)`: a Promise of what the callback gives
    // once it ran with the lock, which is released then.
    async request(name, ...args) {
      const callback = args.pop();
      const options = args[0] ?? {};
      if (typeof callback !== "function") {
        throw new TypeError(`Invalid callback: '${callback}', not a function.`);
      }
      const {
        mode = "exclusive",
        ifAvailable = false,
        steal = false,
        signal
      } = options;
      name = String(name);
      const unsupported = /* @__PURE__ */ __name((message) => new DOMException(message, "NotSupportedError"), "unsupported");
      if (mode !== "exclusive" && mode !== "shared") {
        throw new TypeError(`Invalid lock mode: '${mode}'.`);
      } else if (name.startsWith("-")) {
        throw unsupported(`Invalid lock name: '${name}', starting with '-'.`);
      } else if (steal && (ifAvailable || mode === "shared")) {
        throw unsupported("Unable to steal a lock if available or shared.");
      } else if (signal && (steal || ifAvailable)) {
        throw unsupported("Unable to abort a request that steals or waits not.");
      }
      signal?.throwIfAborted();
      return new Promise((resolve, reject) => {
        let id;
        const abort2 = /* @__PURE__ */ __name(() => {
          natives.locks.cancel(id);
          reject(signal.reason);
        }, "abort");
        const run = /* @__PURE__ */ __name(async (isGranted) => {
          signal?.removeEventListener("abort", abort2);
          if (signal?.aborted) {
            natives.locks.release(id);
            reject(signal.reason);
            return;
          }
          try {
            resolve(
              await callback(isGranted ? new Lock(internal, name, mode) : null)
            );
          } catch (err) {
            reject(err);
          } finally {
            if (isGranted) natives.locks.release(id);
          }
        }, "run");
        const receive = /* @__PURE__ */ __name((state2) => {
          if (state2 === "granted") {
            run(true);
          } else {
            reject(new DOMException("The lock was stolen.", "AbortError"));
          }
        }, "receive");
        const [number, state] = natives.locks.request(
          toKey(name),
          mode === "exclusive",
          ifAvailable,
          steal,
          receive
        );
        id = number;
        if (state === "waiting") {
          signal?.addEventListener("abort", abort2);
        } else {
          queueMicrotask(() => run(state === "granted"));
        }
      });
    }
    async query() {
      const { held, pending } = natives.locks.query();
      const decode = /* @__PURE__ */ __name((list) => list.map((info) => ({ ...info, name: fromKey(info.name) })), "decode");
      return { held: decode(held), pending: decode(pending) };
    }
  };
  setToStringTag(Lock, LockManager);
  function toKey(name) {
    return Array.from(
      { length: name.length },
      (_3, i2) => name.charCodeAt(i2).toString(16).padStart(4, "0")
    ).join("");
  }
  __name(toKey, "toKey");
  function fromKey(key) {
    return String.fromCharCode(
      ...(key.match(/.{4}/g) ?? []).map((code) => parseInt(code, 16))
    );
  }
  __name(fromKey, "fromKey");

  // src/palette.js
  var palettes = /* @__PURE__ */ new Map();
  var lastId = 0;
  var Palette = class {
    static {
      __name(this, "Palette");
    }
    constructor(title = "", components, values) {
      if (!components || typeof components !== "object") {
        throw new TypeError("Invalid components: they must be an object.");
      }
      this.title = String(title);
      this.components = components;
      this.values = values && typeof values === "object" ? values : {};
      for (const component of getComponents(components, this.values)) {
        if (this.values[component.name] === void 0) {
          this.values[component.name] = getValue(component, component.value);
        }
      }
      palettes.set(++lastId, {
        palette: this,
        defaults: getComponents(components),
        reported: ""
      });
    }
    // Every component's value back to the one it was defined with.
    reset() {
      const { defaults: defaults2 } = [...palettes.values()].find(
        (entry) => entry.palette === this
      );
      for (const component of defaults2) {
        const value = getValue(component, component.value);
        this.values[component.name] = value;
        this.components[component.name].value = value;
      }
    }
  };
  setToStringTag(Palette);
  function takePalettes() {
    const changed = [];
    for (const [id, entry] of palettes) {
      const state = getState2(id, entry.palette);
      const text = JSON.stringify(state);
      if (entry.reported !== text) {
        entry.reported = text;
        changed.push(state);
      }
    }
    return changed;
  }
  __name(takePalettes, "takePalettes");
  function hasPalettes() {
    return palettes.size > 0;
  }
  __name(hasPalettes, "hasPalettes");
  function handlePaletteEvent(id, type, name, value) {
    const entry = palettes.get(id);
    if (entry) {
      const { palette } = entry;
      const { components, values } = palette;
      const definition = components[name];
      if (type === "change") {
        const component = getComponents(components, values).find(
          (component2) => component2.name === name
        );
        if (component) {
          value = getValue(component, value);
          values[name] = value;
          entry.reported = JSON.stringify(getState2(id, palette));
          definition.name = name;
          definition.value = value;
          call(definition, "onChange", value);
          call(palette, "onChange", definition);
        }
      } else if (type === "click") {
        call(definition, "onClick");
        call(definition, "onSelect");
      } else if (type === "close") {
        palettes.delete(id);
        call(palette, "onClose");
      }
    }
  }
  __name(handlePaletteEvent, "handlePaletteEvent");
  function getState2(id, palette) {
    const { title, components, values } = palette;
    return { id, title, components: getComponents(components, values) };
  }
  __name(getState2, "getState");
  function call(owner, name, ...args) {
    if (typeof owner?.[name] === "function") owner[name](...args);
  }
  __name(call, "call");

  // src/storage.js
  var sessions = /* @__PURE__ */ new WeakMap();
  var Storage = class {
    static {
      __name(this, "Storage");
    }
    constructor(key) {
      checkInternal(key, "Storage", "use localStorage or sessionStorage");
    }
    get length() {
      return getKeys(this).length;
    }
    key(index) {
      return getKeys(this)[index >>> 0] ?? null;
    }
    getItem(key) {
      checkArguments(arguments, 1, "getItem");
      return natives.storage.getItem(getSession(this), String(key));
    }
    // Throws a `QuotaExceededError` when that's more than it holds.
    setItem(key, value) {
      checkArguments(arguments, 2, "setItem");
      natives.storage.setItem(getSession(this), String(key), String(value));
    }
    removeItem(key) {
      checkArguments(arguments, 1, "removeItem");
      natives.storage.removeItem(getSession(this), String(key));
    }
    clear() {
      natives.storage.clear(getSession(this));
    }
  };
  setToStringTag(Storage);
  var handler = {
    get(target, key, receiver) {
      return isItemKey(target, key) ? target.getItem(key) ?? void 0 : Reflect.get(target, key, receiver);
    },
    set(target, key, value, receiver) {
      if (typeof key === "string") {
        target.setItem(key, value);
        return true;
      } else {
        return Reflect.set(target, key, value, receiver);
      }
    },
    has(target, key) {
      return typeof key === "string" && target.getItem(key) !== null || Reflect.has(target, key);
    },
    deleteProperty(target, key) {
      if (isItemKey(target, key)) {
        target.removeItem(key);
        return true;
      } else {
        return Reflect.deleteProperty(target, key);
      }
    },
    // The items' keys, then the storage's own, as `Object.keys()` lists them.
    ownKeys(target) {
      return [.../* @__PURE__ */ new Set([...getKeys(target), ...Reflect.ownKeys(target)])];
    },
    getOwnPropertyDescriptor(target, key) {
      const value = isItemKey(target, key) ? target.getItem(key) : null;
      return value !== null ? { value, writable: true, enumerable: true, configurable: true } : Reflect.getOwnPropertyDescriptor(target, key);
    }
  };
  function createStorage(isSession) {
    const target = new Storage(internal);
    const storage = new Proxy(target, handler);
    sessions.set(target, isSession);
    sessions.set(storage, isSession);
    return storage;
  }
  __name(createStorage, "createStorage");
  function getSession(storage) {
    const isSession = sessions.get(storage);
    if (isSession === void 0) {
      throw new TypeError(`Invalid storage: '${storage}', not a Storage.`);
    }
    return isSession;
  }
  __name(getSession, "getSession");
  function getKeys(storage) {
    return natives.storage.keys(getSession(storage));
  }
  __name(getKeys, "getKeys");
  function isItemKey(target, key) {
    return typeof key === "string" && !(key in target);
  }
  __name(isItemKey, "isItemKey");

  // src/storage-manager.js
  var StorageManager = class {
    static {
      __name(this, "StorageManager");
    }
    async estimate() {
      return { usage: natives.fs.usage() };
    }
    async persist() {
      return true;
    }
    async persisted() {
      return true;
    }
    async getDirectory() {
      const path = natives.fs.privateDirectory();
      if (path === null) {
        throw new DOMException(
          "Unable to get the directory: the script has no storage of its own.",
          "SecurityError"
        );
      }
      return getDirectoryHandle(path);
    }
  };
  setToStringTag(StorageManager);

  // src/url.js
  var parts = [
    "protocol",
    "username",
    "password",
    "host",
    "hostname",
    "port",
    "pathname",
    "search",
    "hash"
  ];
  var setPairs;
  var setSearch;
  var URL2 = class _URL {
    static {
      __name(this, "URL");
    }
    // The parts as the runtime parsed them:
    #parts;
    #searchParams = null;
    constructor(url, base) {
      this.#parts = parse(url, base);
      if (!this.#parts) {
        throw new TypeError(`Invalid URL: '${url}'.`);
      }
    }
    static {
      setSearch = /* @__PURE__ */ __name((url, query) => {
        url.#parts = natives.url.set(url.#parts.href, "search", query);
      }, "setSearch");
    }
    static canParse(url, base) {
      return !!parse(url, base);
    }
    static parse(url, base) {
      return parse(url, base) ? new _URL(url, base) : null;
    }
    get href() {
      return this.#parts.href;
    }
    set href(href) {
      this.#set("href", href);
    }
    get origin() {
      return this.#parts.origin;
    }
    get searchParams() {
      if (!this.#searchParams) {
        this.#searchParams = new URLSearchParams2(this.#parts.search);
        linksByParams.set(this.#searchParams, this);
      }
      return this.#searchParams;
    }
    toString() {
      return this.#parts.href;
    }
    toJSON() {
      return this.#parts.href;
    }
    // Set a part, and the search params follow.
    #set(part, value) {
      this.#parts = natives.url.set(this.#parts.href, part, String(value));
      if (this.#searchParams) {
        setPairs(this.#searchParams, parseQuery(this.#parts.search));
      }
    }
    static {
      for (const part of parts) {
        inject(
          _URL.prototype,
          {
            get [part]() {
              return this.#parts[part];
            },
            set [part](value) {
              this.#set(part, value);
            }
          },
          { enumerable: true }
        );
      }
    }
  };
  var linksByParams = /* @__PURE__ */ new WeakMap();
  var URLSearchParams2 = class _URLSearchParams {
    static {
      __name(this, "URLSearchParams");
    }
    #pairs = [];
    // A query string (with or without `?`), `[[name, value], …]`,
    // `{ name: value }` or another `URLSearchParams`.
    constructor(init = "") {
      if (init instanceof _URLSearchParams) {
        this.#pairs = init.#pairs.map((pair) => [...pair]);
      } else if (init !== null && typeof init === "object") {
        this.#pairs = getPairs(init).map((pair) => pair.map(String));
      } else {
        this.#pairs = parseQuery(String(init));
      }
    }
    static {
      setPairs = /* @__PURE__ */ __name((params, pairs) => {
        params.#pairs = pairs;
      }, "setPairs");
    }
    get size() {
      return this.#pairs.length;
    }
    append(name, value) {
      this.#pairs.push([String(name), String(value)]);
      this.#update();
    }
    delete(name, value) {
      name = String(name);
      this.#pairs = this.#pairs.filter(
        (pair) => pair[0] !== name || value !== void 0 && pair[1] !== String(value)
      );
      this.#update();
    }
    get(name) {
      return this.#pairs.find((pair) => pair[0] === String(name))?.[1] ?? null;
    }
    getAll(name) {
      return this.#pairs.filter((pair) => pair[0] === String(name)).map(([, value]) => value);
    }
    has(name, value) {
      return this.#pairs.some(
        (pair) => pair[0] === String(name) && (value === void 0 || pair[1] === String(value))
      );
    }
    set(name, value) {
      this.#pairs = setFirst(this.#pairs, [String(name), String(value)]);
      this.#update();
    }
    // By name, in UTF-16 code units, as strings compare: stable.
    sort() {
      this.#pairs.sort(([a3], [b3]) => a3 < b3 ? -1 : a3 > b3 ? 1 : 0);
      this.#update();
    }
    *entries() {
      for (const [name, value] of this.#pairs) yield [name, value];
    }
    toString() {
      return natives.url.serializeQuery(this.#pairs);
    }
    // The URL they belong to follows.
    #update() {
      const url = linksByParams.get(this);
      if (url) setSearch(url, this.toString());
    }
  };
  inject(URLSearchParams2.prototype, pairIterable);
  setToStringTag(URL2, URLSearchParams2);
  function parse(url, base) {
    return base === void 0 ? natives.url.parse(String(url)) : natives.url.parse(String(url), String(base));
  }
  __name(parse, "parse");
  function parseQuery(query) {
    return natives.url.parseQuery(query.replace(/^\?/, ""));
  }
  __name(parseQuery, "parseQuery");

  // ../vendor/urlpattern-polyfill.mjs
  var Pe2 = Object.defineProperty;
  var a2 = /* @__PURE__ */ __name((e2, t2) => Pe2(e2, "name", { value: t2, configurable: true }), "a");
  var P2 = class {
    static {
      __name(this, "P");
    }
    type = 3;
    name = "";
    prefix = "";
    value = "";
    suffix = "";
    modifier = 3;
    constructor(t2, r2, n2, c2, l2, f2) {
      this.type = t2, this.name = r2, this.prefix = n2, this.value = c2, this.suffix = l2, this.modifier = f2;
    }
    hasCustomName() {
      return this.name !== "" && typeof this.name != "number";
    }
  };
  a2(P2, "Part");
  var Re2 = /[$_\p{ID_Start}]/u;
  var Ee2 = /[$_\u200C\u200D\p{ID_Continue}]/u;
  var v2 = ".*";
  function Oe2(e2, t2) {
    return (t2 ? /^[\x00-\xFF]*$/ : /^[\x00-\x7F]*$/).test(e2);
  }
  __name(Oe2, "Oe");
  a2(Oe2, "isASCII");
  function D2(e2, t2 = false) {
    let r2 = [], n2 = 0;
    for (; n2 < e2.length; ) {
      let c2 = e2[n2], l2 = a2(function(f2) {
        if (!t2) throw new TypeError(f2);
        r2.push({ type: "INVALID_CHAR", index: n2, value: e2[n2++] });
      }, "ErrorOrInvalid");
      if (c2 === "*") {
        r2.push({ type: "ASTERISK", index: n2, value: e2[n2++] });
        continue;
      }
      if (c2 === "+" || c2 === "?") {
        r2.push({ type: "OTHER_MODIFIER", index: n2, value: e2[n2++] });
        continue;
      }
      if (c2 === "\\") {
        r2.push({ type: "ESCAPED_CHAR", index: n2++, value: e2[n2++] });
        continue;
      }
      if (c2 === "{") {
        r2.push({ type: "OPEN", index: n2, value: e2[n2++] });
        continue;
      }
      if (c2 === "}") {
        r2.push({ type: "CLOSE", index: n2, value: e2[n2++] });
        continue;
      }
      if (c2 === ":") {
        let f2 = "", s2 = n2 + 1;
        for (; s2 < e2.length; ) {
          let i2 = e2.substr(s2, 1);
          if (s2 === n2 + 1 && Re2.test(i2) || s2 !== n2 + 1 && Ee2.test(i2)) {
            f2 += e2[s2++];
            continue;
          }
          break;
        }
        if (!f2) {
          l2(`Missing parameter name at ${n2}`);
          continue;
        }
        r2.push({ type: "NAME", index: n2, value: f2 }), n2 = s2;
        continue;
      }
      if (c2 === "(") {
        let f2 = 1, s2 = "", i2 = n2 + 1, o2 = false;
        if (e2[i2] === "?") {
          l2(`Pattern cannot start with "?" at ${i2}`);
          continue;
        }
        for (; i2 < e2.length; ) {
          if (!Oe2(e2[i2], false)) {
            l2(`Invalid character '${e2[i2]}' at ${i2}.`), o2 = true;
            break;
          }
          if (e2[i2] === "\\") {
            s2 += e2[i2++] + e2[i2++];
            continue;
          }
          if (e2[i2] === ")") {
            if (f2--, f2 === 0) {
              i2++;
              break;
            }
          } else if (e2[i2] === "(" && (f2++, e2[i2 + 1] !== "?")) {
            l2(`Capturing groups are not allowed at ${i2}`), o2 = true;
            break;
          }
          s2 += e2[i2++];
        }
        if (o2) continue;
        if (f2) {
          l2(`Unbalanced pattern at ${n2}`);
          continue;
        }
        if (!s2) {
          l2(`Missing pattern at ${n2}`);
          continue;
        }
        r2.push({ type: "REGEX", index: n2, value: s2 }), n2 = i2;
        continue;
      }
      r2.push({ type: "CHAR", index: n2, value: e2[n2++] });
    }
    return r2.push({ type: "END", index: n2, value: "" }), r2;
  }
  __name(D2, "D");
  a2(D2, "lexer");
  function F2(e2, t2 = {}) {
    let r2 = D2(e2);
    t2.delimiter ??= "/#?", t2.prefixes ??= "./";
    let n2 = `[^${x2(t2.delimiter)}]+?`, c2 = [], l2 = 0, f2 = 0, s2 = "", i2 = /* @__PURE__ */ new Set(), o2 = a2((u2) => {
      if (f2 < r2.length && r2[f2].type === u2) return r2[f2++].value;
    }, "tryConsume"), h2 = a2(() => o2("OTHER_MODIFIER") ?? o2("ASTERISK"), "tryConsumeModifier"), p2 = a2((u2) => {
      let d2 = o2(u2);
      if (d2 !== void 0) return d2;
      let { type: g2, index: y2 } = r2[f2];
      throw new TypeError(`Unexpected ${g2} at ${y2}, expected ${u2}`);
    }, "mustConsume"), A2 = a2(() => {
      let u2 = "", d2;
      for (; d2 = o2("CHAR") ?? o2("ESCAPED_CHAR"); ) u2 += d2;
      return u2;
    }, "consumeText"), xe2 = a2((u2) => u2, "DefaultEncodePart"), N2 = t2.encodePart || xe2, H2 = "", $2 = a2((u2) => {
      H2 += u2;
    }, "appendToPendingFixedValue"), M2 = a2(() => {
      H2.length && (c2.push(new P2(3, "", "", N2(H2), "", 3)), H2 = "");
    }, "maybeAddPartFromPendingFixedValue"), X2 = a2((u2, d2, g2, y2, Z2) => {
      let m2 = 3;
      switch (Z2) {
        case "?":
          m2 = 1;
          break;
        case "*":
          m2 = 0;
          break;
        case "+":
          m2 = 2;
          break;
      }
      if (!d2 && !g2 && m2 === 3) {
        $2(u2);
        return;
      }
      if (M2(), !d2 && !g2) {
        if (!u2) return;
        c2.push(new P2(3, "", "", N2(u2), "", m2));
        return;
      }
      let S2;
      g2 ? g2 === "*" ? S2 = v2 : S2 = g2 : S2 = n2;
      let k2 = 2;
      S2 === n2 ? (k2 = 1, S2 = "") : S2 === v2 && (k2 = 0, S2 = "");
      let E2;
      if (d2 ? E2 = d2 : g2 && (E2 = l2++), i2.has(E2)) throw new TypeError(`Duplicate name '${E2}'.`);
      i2.add(E2), c2.push(new P2(k2, E2, N2(u2), S2, N2(y2), m2));
    }, "addPart");
    for (; f2 < r2.length; ) {
      let u2 = o2("CHAR"), d2 = o2("NAME"), g2 = o2("REGEX");
      if (!d2 && !g2 && (g2 = o2("ASTERISK")), d2 || g2) {
        let m2 = u2 ?? "";
        t2.prefixes.indexOf(m2) === -1 && ($2(m2), m2 = ""), M2();
        let S2 = h2();
        X2(m2, d2, g2, "", S2);
        continue;
      }
      let y2 = u2 ?? o2("ESCAPED_CHAR");
      if (y2) {
        $2(y2);
        continue;
      }
      if (o2("OPEN")) {
        let m2 = A2(), S2 = o2("NAME"), k2 = o2("REGEX");
        !S2 && !k2 && (k2 = o2("ASTERISK"));
        let E2 = A2();
        p2("CLOSE");
        let be2 = h2();
        X2(m2, S2, k2, E2, be2);
        continue;
      }
      M2(), p2("END");
    }
    return c2;
  }
  __name(F2, "F");
  a2(F2, "parse");
  function x2(e2) {
    return e2.replace(/([.+*?^${}()[\]|/\\])/g, "\\$1");
  }
  __name(x2, "x");
  a2(x2, "escapeString");
  function B2(e2) {
    return e2 && e2.ignoreCase ? "ui" : "u";
  }
  __name(B2, "B");
  a2(B2, "flags");
  function q2(e2, t2, r2) {
    return W2(F2(e2, r2), t2, r2);
  }
  __name(q2, "q");
  a2(q2, "stringToRegexp");
  function T2(e2) {
    switch (e2) {
      case 0:
        return "*";
      case 1:
        return "?";
      case 2:
        return "+";
      case 3:
        return "";
    }
  }
  __name(T2, "T");
  a2(T2, "modifierToString");
  function W2(e2, t2, r2 = {}) {
    r2.delimiter ??= "/#?", r2.prefixes ??= "./", r2.sensitive ??= false, r2.strict ??= false, r2.end ??= true, r2.start ??= true, r2.endsWith = "";
    let n2 = r2.start ? "^" : "";
    for (let s2 of e2) {
      if (s2.type === 3) {
        s2.modifier === 3 ? n2 += x2(s2.value) : n2 += `(?:${x2(s2.value)})${T2(s2.modifier)}`;
        continue;
      }
      t2 && t2.push(s2.name);
      let i2 = `[^${x2(r2.delimiter)}]+?`, o2 = s2.value;
      if (s2.type === 1 ? o2 = i2 : s2.type === 0 && (o2 = v2), !s2.prefix.length && !s2.suffix.length) {
        s2.modifier === 3 || s2.modifier === 1 ? n2 += `(${o2})${T2(s2.modifier)}` : n2 += `((?:${o2})${T2(s2.modifier)})`;
        continue;
      }
      if (s2.modifier === 3 || s2.modifier === 1) {
        n2 += `(?:${x2(s2.prefix)}(${o2})${x2(s2.suffix)})`, n2 += T2(s2.modifier);
        continue;
      }
      n2 += `(?:${x2(s2.prefix)}`, n2 += `((?:${o2})(?:`, n2 += x2(s2.suffix), n2 += x2(s2.prefix), n2 += `(?:${o2}))*)${x2(s2.suffix)})`, s2.modifier === 0 && (n2 += "?");
    }
    let c2 = `[${x2(r2.endsWith)}]|$`, l2 = `[${x2(r2.delimiter)}]`;
    if (r2.end) return r2.strict || (n2 += `${l2}?`), r2.endsWith.length ? n2 += `(?=${c2})` : n2 += "$", new RegExp(n2, B2(r2));
    r2.strict || (n2 += `(?:${l2}(?=${c2}))?`);
    let f2 = false;
    if (e2.length) {
      let s2 = e2[e2.length - 1];
      s2.type === 3 && s2.modifier === 3 && (f2 = r2.delimiter.indexOf(s2) > -1);
    }
    return f2 || (n2 += `(?=${l2}|${c2})`), new RegExp(n2, B2(r2));
  }
  __name(W2, "W");
  a2(W2, "partsToRegexp");
  var b2 = { delimiter: "", prefixes: "", sensitive: true, strict: true };
  var J2 = { delimiter: ".", prefixes: "", sensitive: true, strict: true };
  var Q2 = { delimiter: "/", prefixes: "/", sensitive: true, strict: true };
  function ee2(e2, t2) {
    return e2.length ? e2[0] === "/" ? true : !t2 || e2.length < 2 ? false : (e2[0] == "\\" || e2[0] == "{") && e2[1] == "/" : false;
  }
  __name(ee2, "ee");
  a2(ee2, "isAbsolutePathname");
  function te2(e2, t2) {
    return e2.startsWith(t2) ? e2.substring(t2.length, e2.length) : e2;
  }
  __name(te2, "te");
  a2(te2, "maybeStripPrefix");
  function ke2(e2, t2) {
    return e2.endsWith(t2) ? e2.substr(0, e2.length - t2.length) : e2;
  }
  __name(ke2, "ke");
  a2(ke2, "maybeStripSuffix");
  function _2(e2) {
    return !e2 || e2.length < 2 ? false : e2[0] === "[" || (e2[0] === "\\" || e2[0] === "{") && e2[1] === "[";
  }
  __name(_2, "_");
  a2(_2, "treatAsIPv6Hostname");
  var re2 = ["ftp", "file", "http", "https", "ws", "wss"];
  function U2(e2) {
    if (!e2) return true;
    for (let t2 of re2) if (e2.test(t2)) return true;
    return false;
  }
  __name(U2, "U");
  a2(U2, "isSpecialScheme");
  function ne2(e2, t2) {
    if (e2 = te2(e2, "#"), t2 || e2 === "") return e2;
    let r2 = new URL("https://example.com");
    return r2.hash = e2, r2.hash ? r2.hash.substring(1, r2.hash.length) : "";
  }
  __name(ne2, "ne");
  a2(ne2, "canonicalizeHash");
  function se2(e2, t2) {
    if (e2 = te2(e2, "?"), t2 || e2 === "") return e2;
    let r2 = new URL("https://example.com");
    return r2.search = e2, r2.search ? r2.search.substring(1, r2.search.length) : "";
  }
  __name(se2, "se");
  a2(se2, "canonicalizeSearch");
  function ie2(e2, t2) {
    return t2 || e2 === "" ? e2 : _2(e2) ? K2(e2) : j2(e2);
  }
  __name(ie2, "ie");
  a2(ie2, "canonicalizeHostname");
  function ae2(e2, t2) {
    if (t2 || e2 === "") return e2;
    let r2 = new URL("https://example.com");
    return r2.password = e2, r2.password;
  }
  __name(ae2, "ae");
  a2(ae2, "canonicalizePassword");
  function oe2(e2, t2) {
    if (t2 || e2 === "") return e2;
    let r2 = new URL("https://example.com");
    return r2.username = e2, r2.username;
  }
  __name(oe2, "oe");
  a2(oe2, "canonicalizeUsername");
  function ce2(e2, t2, r2) {
    if (r2 || e2 === "") return e2;
    if (t2 && !re2.includes(t2)) return new URL(`${t2}:${e2}`).pathname;
    let n2 = e2[0] == "/";
    return e2 = new URL(n2 ? e2 : "/-" + e2, "https://example.com").pathname, n2 || (e2 = e2.substring(2, e2.length)), e2;
  }
  __name(ce2, "ce");
  a2(ce2, "canonicalizePathname");
  function le2(e2, t2, r2) {
    return z2(t2) === e2 && (e2 = ""), r2 || e2 === "" ? e2 : G2(e2);
  }
  __name(le2, "le");
  a2(le2, "canonicalizePort");
  function fe2(e2, t2) {
    return e2 = ke2(e2, ":"), t2 || e2 === "" ? e2 : w2(e2);
  }
  __name(fe2, "fe");
  a2(fe2, "canonicalizeProtocol");
  function z2(e2) {
    switch (e2) {
      case "ws":
      case "http":
        return "80";
      case "wws":
      case "https":
        return "443";
      case "ftp":
        return "21";
      default:
        return "";
    }
  }
  __name(z2, "z");
  a2(z2, "defaultPortForProtocol");
  function w2(e2) {
    if (e2 === "") return e2;
    if (/^[-+.A-Za-z0-9]*$/.test(e2)) return e2.toLowerCase();
    throw new TypeError(`Invalid protocol '${e2}'.`);
  }
  __name(w2, "w");
  a2(w2, "protocolEncodeCallback");
  function he2(e2) {
    if (e2 === "") return e2;
    let t2 = new URL("https://example.com");
    return t2.username = e2, t2.username;
  }
  __name(he2, "he");
  a2(he2, "usernameEncodeCallback");
  function ue2(e2) {
    if (e2 === "") return e2;
    let t2 = new URL("https://example.com");
    return t2.password = e2, t2.password;
  }
  __name(ue2, "ue");
  a2(ue2, "passwordEncodeCallback");
  function j2(e2) {
    if (e2 === "") return e2;
    if (/[\t\n\r #%/:<>?@[\]^\\|]/g.test(e2)) throw new TypeError(`Invalid hostname '${e2}'`);
    let t2 = new URL("https://example.com");
    return t2.hostname = e2, t2.hostname;
  }
  __name(j2, "j");
  a2(j2, "hostnameEncodeCallback");
  function K2(e2) {
    if (e2 === "") return e2;
    if (/[^0-9a-fA-F[\]:]/g.test(e2)) throw new TypeError(`Invalid IPv6 hostname '${e2}'`);
    return e2.toLowerCase();
  }
  __name(K2, "K");
  a2(K2, "ipv6HostnameEncodeCallback");
  function G2(e2) {
    if (e2 === "" || /^[0-9]*$/.test(e2) && parseInt(e2) <= 65535) return e2;
    throw new TypeError(`Invalid port '${e2}'.`);
  }
  __name(G2, "G");
  a2(G2, "portEncodeCallback");
  function de2(e2) {
    if (e2 === "") return e2;
    let t2 = new URL("https://example.com");
    return t2.pathname = e2[0] !== "/" ? "/-" + e2 : e2, e2[0] !== "/" ? t2.pathname.substring(2, t2.pathname.length) : t2.pathname;
  }
  __name(de2, "de");
  a2(de2, "standardURLPathnameEncodeCallback");
  function pe2(e2) {
    return e2 === "" ? e2 : new URL(`data:${e2}`).pathname;
  }
  __name(pe2, "pe");
  a2(pe2, "pathURLPathnameEncodeCallback");
  function ge2(e2) {
    if (e2 === "") return e2;
    let t2 = new URL("https://example.com");
    return t2.search = e2, t2.search.substring(1, t2.search.length);
  }
  __name(ge2, "ge");
  a2(ge2, "searchEncodeCallback");
  function me2(e2) {
    if (e2 === "") return e2;
    let t2 = new URL("https://example.com");
    return t2.hash = e2, t2.hash.substring(1, t2.hash.length);
  }
  __name(me2, "me");
  a2(me2, "hashEncodeCallback");
  var C2 = class {
    static {
      __name(this, "C");
    }
    #i;
    #n = [];
    #t = {};
    #e = 0;
    #s = 1;
    #l = 0;
    #o = 0;
    #d = 0;
    #p = 0;
    #g = false;
    constructor(t2) {
      this.#i = t2;
    }
    get result() {
      return this.#t;
    }
    parse() {
      for (this.#n = D2(this.#i, true); this.#e < this.#n.length; this.#e += this.#s) {
        if (this.#s = 1, this.#n[this.#e].type === "END") {
          if (this.#o === 0) {
            this.#b(), this.#f() ? this.#r(9, 1) : this.#h() ? this.#r(8, 1) : this.#r(7, 0);
            continue;
          } else if (this.#o === 2) {
            this.#u(5);
            continue;
          }
          this.#r(10, 0);
          break;
        }
        if (this.#d > 0) if (this.#A()) this.#d -= 1;
        else continue;
        if (this.#T()) {
          this.#d += 1;
          continue;
        }
        switch (this.#o) {
          case 0:
            this.#P() && this.#u(1);
            break;
          case 1:
            if (this.#P()) {
              this.#C();
              let t2 = 7, r2 = 1;
              this.#E() ? (t2 = 2, r2 = 3) : this.#g && (t2 = 2), this.#r(t2, r2);
            }
            break;
          case 2:
            this.#S() ? this.#u(3) : (this.#x() || this.#h() || this.#f()) && this.#u(5);
            break;
          case 3:
            this.#O() ? this.#r(4, 1) : this.#S() && this.#r(5, 1);
            break;
          case 4:
            this.#S() && this.#r(5, 1);
            break;
          case 5:
            this.#y() ? this.#p += 1 : this.#w() && (this.#p -= 1), this.#k() && !this.#p ? this.#r(6, 1) : this.#x() ? this.#r(7, 0) : this.#h() ? this.#r(8, 1) : this.#f() && this.#r(9, 1);
            break;
          case 6:
            this.#x() ? this.#r(7, 0) : this.#h() ? this.#r(8, 1) : this.#f() && this.#r(9, 1);
            break;
          case 7:
            this.#h() ? this.#r(8, 1) : this.#f() && this.#r(9, 1);
            break;
          case 8:
            this.#f() && this.#r(9, 1);
            break;
          case 9:
            break;
          case 10:
            break;
        }
      }
      this.#t.hostname !== void 0 && this.#t.port === void 0 && (this.#t.port = "");
    }
    #r(t2, r2) {
      switch (this.#o) {
        case 0:
          break;
        case 1:
          this.#t.protocol = this.#c();
          break;
        case 2:
          break;
        case 3:
          this.#t.username = this.#c();
          break;
        case 4:
          this.#t.password = this.#c();
          break;
        case 5:
          this.#t.hostname = this.#c();
          break;
        case 6:
          this.#t.port = this.#c();
          break;
        case 7:
          this.#t.pathname = this.#c();
          break;
        case 8:
          this.#t.search = this.#c();
          break;
        case 9:
          this.#t.hash = this.#c();
          break;
        case 10:
          break;
      }
      this.#o !== 0 && t2 !== 10 && ([1, 2, 3, 4].includes(this.#o) && [6, 7, 8, 9].includes(t2) && (this.#t.hostname ??= ""), [1, 2, 3, 4, 5, 6].includes(this.#o) && [8, 9].includes(t2) && (this.#t.pathname ??= this.#g ? "/" : ""), [1, 2, 3, 4, 5, 6, 7].includes(this.#o) && t2 === 9 && (this.#t.search ??= "")), this.#R(t2, r2);
    }
    #R(t2, r2) {
      this.#o = t2, this.#l = this.#e + r2, this.#e += r2, this.#s = 0;
    }
    #b() {
      this.#e = this.#l, this.#s = 0;
    }
    #u(t2) {
      this.#b(), this.#o = t2;
    }
    #m(t2) {
      return t2 < 0 && (t2 = this.#n.length - t2), t2 < this.#n.length ? this.#n[t2] : this.#n[this.#n.length - 1];
    }
    #a(t2, r2) {
      let n2 = this.#m(t2);
      return n2.value === r2 && (n2.type === "CHAR" || n2.type === "ESCAPED_CHAR" || n2.type === "INVALID_CHAR");
    }
    #P() {
      return this.#a(this.#e, ":");
    }
    #E() {
      return this.#a(this.#e + 1, "/") && this.#a(this.#e + 2, "/");
    }
    #S() {
      return this.#a(this.#e, "@");
    }
    #O() {
      return this.#a(this.#e, ":");
    }
    #k() {
      return this.#a(this.#e, ":");
    }
    #x() {
      return this.#a(this.#e, "/");
    }
    #h() {
      if (this.#a(this.#e, "?")) return true;
      if (this.#n[this.#e].value !== "?") return false;
      let t2 = this.#m(this.#e - 1);
      return t2.type !== "NAME" && t2.type !== "REGEX" && t2.type !== "CLOSE" && t2.type !== "ASTERISK";
    }
    #f() {
      return this.#a(this.#e, "#");
    }
    #T() {
      return this.#n[this.#e].type == "OPEN";
    }
    #A() {
      return this.#n[this.#e].type == "CLOSE";
    }
    #y() {
      return this.#a(this.#e, "[");
    }
    #w() {
      return this.#a(this.#e, "]");
    }
    #c() {
      let t2 = this.#n[this.#e], r2 = this.#m(this.#l).index;
      return this.#i.substring(r2, t2.index);
    }
    #C() {
      let t2 = {};
      Object.assign(t2, b2), t2.encodePart = w2;
      let r2 = q2(this.#c(), void 0, t2);
      this.#g = U2(r2);
    }
  };
  a2(C2, "Parser");
  var V2 = ["protocol", "username", "password", "hostname", "port", "pathname", "search", "hash"];
  var O2 = "*";
  function Se2(e2, t2) {
    if (typeof e2 != "string") throw new TypeError("parameter 1 is not of type 'string'.");
    let r2 = new URL(e2, t2);
    return { protocol: r2.protocol.substring(0, r2.protocol.length - 1), username: r2.username, password: r2.password, hostname: r2.hostname, port: r2.port, pathname: r2.pathname, search: r2.search !== "" ? r2.search.substring(1, r2.search.length) : void 0, hash: r2.hash !== "" ? r2.hash.substring(1, r2.hash.length) : void 0 };
  }
  __name(Se2, "Se");
  a2(Se2, "extractValues");
  function R2(e2, t2) {
    return t2 ? I2(e2) : e2;
  }
  __name(R2, "R");
  a2(R2, "processBaseURLString");
  function L2(e2, t2, r2) {
    let n2;
    if (typeof t2.baseURL == "string") try {
      n2 = new URL(t2.baseURL), t2.protocol === void 0 && (e2.protocol = R2(n2.protocol.substring(0, n2.protocol.length - 1), r2)), !r2 && t2.protocol === void 0 && t2.hostname === void 0 && t2.port === void 0 && t2.username === void 0 && (e2.username = R2(n2.username, r2)), !r2 && t2.protocol === void 0 && t2.hostname === void 0 && t2.port === void 0 && t2.username === void 0 && t2.password === void 0 && (e2.password = R2(n2.password, r2)), t2.protocol === void 0 && t2.hostname === void 0 && (e2.hostname = R2(n2.hostname, r2)), t2.protocol === void 0 && t2.hostname === void 0 && t2.port === void 0 && (e2.port = R2(n2.port, r2)), t2.protocol === void 0 && t2.hostname === void 0 && t2.port === void 0 && t2.pathname === void 0 && (e2.pathname = R2(n2.pathname, r2)), t2.protocol === void 0 && t2.hostname === void 0 && t2.port === void 0 && t2.pathname === void 0 && t2.search === void 0 && (e2.search = R2(n2.search.substring(1, n2.search.length), r2)), t2.protocol === void 0 && t2.hostname === void 0 && t2.port === void 0 && t2.pathname === void 0 && t2.search === void 0 && t2.hash === void 0 && (e2.hash = R2(n2.hash.substring(1, n2.hash.length), r2));
    } catch {
      throw new TypeError(`invalid baseURL '${t2.baseURL}'.`);
    }
    if (typeof t2.protocol == "string" && (e2.protocol = fe2(t2.protocol, r2)), typeof t2.username == "string" && (e2.username = oe2(t2.username, r2)), typeof t2.password == "string" && (e2.password = ae2(t2.password, r2)), typeof t2.hostname == "string" && (e2.hostname = ie2(t2.hostname, r2)), typeof t2.port == "string" && (e2.port = le2(t2.port, e2.protocol, r2)), typeof t2.pathname == "string") {
      if (e2.pathname = t2.pathname, n2 && !ee2(e2.pathname, r2)) {
        let c2 = n2.pathname.lastIndexOf("/");
        c2 >= 0 && (e2.pathname = R2(n2.pathname.substring(0, c2 + 1), r2) + e2.pathname);
      }
      e2.pathname = ce2(e2.pathname, e2.protocol, r2);
    }
    return typeof t2.search == "string" && (e2.search = se2(t2.search, r2)), typeof t2.hash == "string" && (e2.hash = ne2(t2.hash, r2)), e2;
  }
  __name(L2, "L");
  a2(L2, "applyInit");
  function I2(e2) {
    return e2.replace(/([+*?:{}()\\])/g, "\\$1");
  }
  __name(I2, "I");
  a2(I2, "escapePatternString");
  function Te2(e2) {
    return e2.replace(/([.+*?^${}()[\]|/\\])/g, "\\$1");
  }
  __name(Te2, "Te");
  a2(Te2, "escapeRegexpString");
  function Ae2(e2, t2) {
    t2.delimiter ??= "/#?", t2.prefixes ??= "./", t2.sensitive ??= false, t2.strict ??= false, t2.end ??= true, t2.start ??= true, t2.endsWith = "";
    let r2 = ".*", n2 = `[^${Te2(t2.delimiter)}]+?`, c2 = /[$_\u200C\u200D\p{ID_Continue}]/u, l2 = "";
    for (let f2 = 0; f2 < e2.length; ++f2) {
      let s2 = e2[f2];
      if (s2.type === 3) {
        if (s2.modifier === 3) {
          l2 += I2(s2.value);
          continue;
        }
        l2 += `{${I2(s2.value)}}${T2(s2.modifier)}`;
        continue;
      }
      let i2 = s2.hasCustomName(), o2 = !!s2.suffix.length || !!s2.prefix.length && (s2.prefix.length !== 1 || !t2.prefixes.includes(s2.prefix)), h2 = f2 > 0 ? e2[f2 - 1] : null, p2 = f2 < e2.length - 1 ? e2[f2 + 1] : null;
      if (!o2 && i2 && s2.type === 1 && s2.modifier === 3 && p2 && !p2.prefix.length && !p2.suffix.length) if (p2.type === 3) {
        let A2 = p2.value.length > 0 ? p2.value[0] : "";
        o2 = c2.test(A2);
      } else o2 = !p2.hasCustomName();
      if (!o2 && !s2.prefix.length && h2 && h2.type === 3) {
        let A2 = h2.value[h2.value.length - 1];
        o2 = t2.prefixes.includes(A2);
      }
      o2 && (l2 += "{"), l2 += I2(s2.prefix), i2 && (l2 += `:${s2.name}`), s2.type === 2 ? l2 += `(${s2.value})` : s2.type === 1 ? i2 || (l2 += `(${n2})`) : s2.type === 0 && (!i2 && (!h2 || h2.type === 3 || h2.modifier !== 3 || o2 || s2.prefix !== "") ? l2 += "*" : l2 += `(${r2})`), s2.type === 1 && i2 && s2.suffix.length && c2.test(s2.suffix[0]) && (l2 += "\\"), l2 += I2(s2.suffix), o2 && (l2 += "}"), s2.modifier !== 3 && (l2 += T2(s2.modifier));
    }
    return l2;
  }
  __name(Ae2, "Ae");
  a2(Ae2, "partsToPattern");
  var Y2 = class {
    static {
      __name(this, "Y");
    }
    #i;
    #n = {};
    #t = {};
    #e = {};
    #s = {};
    #l = false;
    constructor(t2 = {}, r2, n2) {
      try {
        let c2;
        if (typeof r2 == "string" ? c2 = r2 : n2 = r2, typeof t2 == "string") {
          let i2 = new C2(t2);
          if (i2.parse(), t2 = i2.result, c2 === void 0 && typeof t2.protocol != "string") throw new TypeError("A base URL must be provided for a relative constructor string.");
          t2.baseURL = c2;
        } else {
          if (!t2 || typeof t2 != "object") throw new TypeError("parameter 1 is not of type 'string' and cannot convert to dictionary.");
          if (c2) throw new TypeError("parameter 1 is not of type 'string'.");
        }
        typeof n2 > "u" && (n2 = { ignoreCase: false });
        let l2 = { ignoreCase: n2.ignoreCase === true }, f2 = { pathname: O2, protocol: O2, username: O2, password: O2, hostname: O2, port: O2, search: O2, hash: O2 };
        this.#i = L2(f2, t2, true), z2(this.#i.protocol) === this.#i.port && (this.#i.port = "");
        let s2;
        for (s2 of V2) {
          if (!(s2 in this.#i)) continue;
          let i2 = {}, o2 = this.#i[s2];
          switch (this.#t[s2] = [], s2) {
            case "protocol":
              Object.assign(i2, b2), i2.encodePart = w2;
              break;
            case "username":
              Object.assign(i2, b2), i2.encodePart = he2;
              break;
            case "password":
              Object.assign(i2, b2), i2.encodePart = ue2;
              break;
            case "hostname":
              Object.assign(i2, J2), _2(o2) ? i2.encodePart = K2 : i2.encodePart = j2;
              break;
            case "port":
              Object.assign(i2, b2), i2.encodePart = G2;
              break;
            case "pathname":
              U2(this.#n.protocol) ? (Object.assign(i2, Q2, l2), i2.encodePart = de2) : (Object.assign(i2, b2, l2), i2.encodePart = pe2);
              break;
            case "search":
              Object.assign(i2, b2, l2), i2.encodePart = ge2;
              break;
            case "hash":
              Object.assign(i2, b2, l2), i2.encodePart = me2;
              break;
          }
          try {
            this.#s[s2] = F2(o2, i2), this.#n[s2] = W2(this.#s[s2], this.#t[s2], i2), this.#e[s2] = Ae2(this.#s[s2], i2), this.#l = this.#l || this.#s[s2].some((h2) => h2.type === 2);
          } catch {
            throw new TypeError(`invalid ${s2} pattern '${this.#i[s2]}'.`);
          }
        }
      } catch (c2) {
        throw new TypeError(`Failed to construct 'URLPattern': ${c2.message}`);
      }
    }
    get [Symbol.toStringTag]() {
      return "URLPattern";
    }
    test(t2 = {}, r2) {
      let n2 = { pathname: "", protocol: "", username: "", password: "", hostname: "", port: "", search: "", hash: "" };
      if (typeof t2 != "string" && r2) throw new TypeError("parameter 1 is not of type 'string'.");
      if (typeof t2 > "u") return false;
      try {
        typeof t2 == "object" ? n2 = L2(n2, t2, false) : n2 = L2(n2, Se2(t2, r2), false);
      } catch {
        return false;
      }
      let c2;
      for (c2 of V2) if (!this.#n[c2].exec(n2[c2])) return false;
      return true;
    }
    exec(t2 = {}, r2) {
      let n2 = { pathname: "", protocol: "", username: "", password: "", hostname: "", port: "", search: "", hash: "" };
      if (typeof t2 != "string" && r2) throw new TypeError("parameter 1 is not of type 'string'.");
      if (typeof t2 > "u") return;
      try {
        typeof t2 == "object" ? n2 = L2(n2, t2, false) : n2 = L2(n2, Se2(t2, r2), false);
      } catch {
        return null;
      }
      let c2 = {};
      r2 ? c2.inputs = [t2, r2] : c2.inputs = [t2];
      let l2;
      for (l2 of V2) {
        let f2 = this.#n[l2].exec(n2[l2]);
        if (!f2) return null;
        let s2 = {};
        for (let [i2, o2] of this.#t[l2].entries()) if (typeof o2 == "string" || typeof o2 == "number") {
          let h2 = f2[i2 + 1];
          s2[o2] = h2;
        }
        c2[l2] = { input: n2[l2] ?? "", groups: s2 };
      }
      return c2;
    }
    static compareComponent(t2, r2, n2) {
      let c2 = a2((i2, o2) => {
        for (let h2 of ["type", "modifier", "prefix", "value", "suffix"]) {
          if (i2[h2] < o2[h2]) return -1;
          if (i2[h2] === o2[h2]) continue;
          return 1;
        }
        return 0;
      }, "comparePart"), l2 = new P2(3, "", "", "", "", 3), f2 = new P2(0, "", "", "", "", 3), s2 = a2((i2, o2) => {
        let h2 = 0;
        for (; h2 < Math.min(i2.length, o2.length); ++h2) {
          let p2 = c2(i2[h2], o2[h2]);
          if (p2) return p2;
        }
        return i2.length === o2.length ? 0 : c2(i2[h2] ?? l2, o2[h2] ?? l2);
      }, "comparePartList");
      return !r2.#e[t2] && !n2.#e[t2] ? 0 : r2.#e[t2] && !n2.#e[t2] ? s2(r2.#s[t2], [f2]) : !r2.#e[t2] && n2.#e[t2] ? s2([f2], n2.#s[t2]) : s2(r2.#s[t2], n2.#s[t2]);
    }
    get protocol() {
      return this.#e.protocol;
    }
    get username() {
      return this.#e.username;
    }
    get password() {
      return this.#e.password;
    }
    get hostname() {
      return this.#e.hostname;
    }
    get port() {
      return this.#e.port;
    }
    get pathname() {
      return this.#e.pathname;
    }
    get search() {
      return this.#e.search;
    }
    get hash() {
      return this.#e.hash;
    }
    get hasRegExpGroups() {
      return this.#l;
    }
  };
  a2(Y2, "URLPattern");

  // src/websocket.js
  var states3 = { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 };
  var schemes = {
    "ws:": "ws:",
    "http:": "ws:",
    "wss:": "wss:",
    "https:": "wss:"
  };
  var WebSocket = class extends EventTarget {
    static {
      __name(this, "WebSocket");
    }
    #url;
    #number;
    #readyState = states3.CONNECTING;
    #protocol = "";
    #binaryType = "blob";
    constructor(url, protocols = []) {
      super();
      url = String(url);
      const parsed = URL.canParse(url) ? new URL(url) : null;
      const scheme = schemes[parsed?.protocol];
      if (!scheme || parsed.hash) {
        throw new DOMException(`Invalid WebSocket URL: '${url}'.`, "SyntaxError");
      }
      parsed.protocol = scheme;
      this.#url = parsed.href;
      this.#number = natives.socket.open(
        this.#url,
        typeof protocols === "string" ? [protocols] : Array.from(protocols, String),
        (incoming) => this.#receive(incoming)
      );
    }
    get url() {
      return this.#url;
    }
    get readyState() {
      return this.#readyState;
    }
    get protocol() {
      return this.#protocol;
    }
    get extensions() {
      return "";
    }
    get bufferedAmount() {
      return 0;
    }
    get binaryType() {
      return this.#binaryType;
    }
    set binaryType(type) {
      if (type === "blob" || type === "arraybuffer") this.#binaryType = type;
    }
    // Text, or the bytes of a `Blob`, a buffer or a view. A closing or closed
    // socket sends nothing, as in browsers.
    send(data) {
      checkArguments(arguments, 1, "send");
      if (this.#readyState === states3.CONNECTING) {
        throw new DOMException(
          "Unable to send: the WebSocket is not open yet.",
          "InvalidStateError"
        );
      }
      if (this.#readyState === states3.OPEN) {
        natives.socket.send(
          this.#number,
          getBufferBytes(data) ?? (data instanceof Blob ? getBytes(data) : String(data))
        );
      }
    }
    // A code of 1000 or 3000 to 4999, a reason of 123 bytes at most.
    close(code, reason = "") {
      if (code !== void 0 && (code = Number(code)) !== 1e3 && !(code >= 3e3 && code <= 4999)) {
        throw new DOMException(
          `Invalid WebSocket close code: '${code}'.`,
          "InvalidAccessError"
        );
      }
      reason = String(reason);
      if (new TextEncoder().encode(reason).length > 123) {
        throw new DOMException(
          "Invalid WebSocket close reason: it is longer than 123 bytes.",
          "SyntaxError"
        );
      }
      if (this.#readyState < states3.CLOSING) {
        this.#readyState = states3.CLOSING;
        natives.socket.close(this.#number, code ?? 1e3, reason);
      }
    }
    // What the socket's thread read: `{ type, … }`.
    #receive({ type, protocol, data, message, code, reason, wasClean }) {
      switch (type) {
        case "open":
          this.#readyState = states3.OPEN;
          this.#protocol = protocol;
          fire(this, new Event("open"));
          break;
        case "message":
          fire(
            this,
            new MessageEvent("message", {
              data: typeof data === "string" ? data : this.#binaryType === "arraybuffer" ? data.buffer : new Blob([data]),
              origin: new URL(this.#url).origin
            })
          );
          break;
        case "error":
          console.error(`WebSocket ${this.#url}: ${message}`);
          fire(this, new Event("error"));
          break;
        case "close":
          this.#readyState = states3.CLOSED;
          fire(this, new CloseEvent("close", { code, reason, wasClean }));
          break;
      }
    }
  };
  defineConstants(WebSocket, states3);
  defineEventHandlers(WebSocket.prototype, "open", "message", "error", "close");
  setToStringTag(WebSocket);

  // src/message-port.js
  var getNumber;
  var detach;
  var MessageChannel = class {
    static {
      __name(this, "MessageChannel");
    }
    #port1;
    #port2;
    constructor() {
      const [first, second] = natives.port.channel();
      this.#port1 = new MessagePort(internal, first);
      this.#port2 = new MessagePort(internal, second);
    }
    get port1() {
      return this.#port1;
    }
    get port2() {
      return this.#port2;
    }
  };
  var MessagePort = class extends EventTarget {
    static {
      __name(this, "MessagePort");
    }
    // `null` once the port is closed or sent:
    #number;
    constructor(key, number) {
      checkInternal(key, "MessagePort", "MessageChannel makes them");
      super();
      this.#number = number;
    }
    static {
      getNumber = /* @__PURE__ */ __name((port) => port.#number, "getNumber");
      detach = /* @__PURE__ */ __name((port) => {
        port.#number = null;
      }, "detach");
    }
    postMessage(message, transfer) {
      checkArguments(arguments, 1, "postMessage");
      postWith(transfer, (ports, numbers2) => {
        if (this.#number !== null) {
          if (ports.includes(this)) {
            throw new DOMException(
              "Invalid postMessage(): a port can't transfer itself.",
              "DataCloneError"
            );
          }
          natives.port.post(this.#number, message, ports, numbers2);
        }
      });
    }
    start() {
      if (this.#number !== null) {
        natives.port.start(
          this.#number,
          ({ type, data, ports }) => fire(this, new MessageEvent(type, { data, ports }))
        );
      }
    }
    close() {
      if (this.#number !== null) {
        natives.port.close(this.#number);
        this.#number = null;
      }
    }
  };
  defineEventHandlers(MessagePort.prototype, "message", "messageerror");
  var { set } = Object.getOwnPropertyDescriptor(
    MessagePort.prototype,
    "onmessage"
  );
  Object.defineProperty(MessagePort.prototype, "onmessage", {
    set(handler2) {
      set.call(this, handler2);
      this.start();
    }
  });
  setToStringTag(MessageChannel, MessagePort);
  function postWith(transfer, send) {
    const list = transfer === void 0 || transfer === null ? [] : typeof transfer === "object" && Symbol.iterator in transfer ? [...transfer] : typeof transfer === "object" ? [...transfer.transfer ?? []] : null;
    if (!list) {
      throw new TypeError(`Invalid transfer list: '${transfer}'.`);
    }
    for (const [index, port] of list.entries()) {
      if (!(port instanceof MessagePort) || getNumber(port) === null || list.indexOf(port) !== index) {
        throw new DOMException(
          `Invalid transfer list: '${port}' can't be transferred.`,
          "DataCloneError"
        );
      }
    }
    send(list, list.map(getNumber));
    list.forEach(detach);
  }
  __name(postWith, "postWith");
  function takePort(port) {
    const number = getNumber(port);
    detach(port);
    return number;
  }
  __name(takePort, "takePort");
  function makePort(number) {
    return new MessagePort(internal, number);
  }
  __name(makePort, "makePort");

  // src/worker.js
  var Worker = class extends EventTarget {
    static {
      __name(this, "Worker");
    }
    #number;
    constructor(url, { type = "classic", name = "" } = {}) {
      super();
      if (type === "module") {
        throw new DOMException(
          "Unsupported Worker: module workers are not supported.",
          "NotSupportedError"
        );
      }
      this.#number = natives.worker.start(
        String(url),
        String(name),
        (sent) => this.#receive(sent)
      );
    }
    postMessage(data, transfer) {
      postWith(
        transfer,
        (ports, numbers2) => natives.worker.post(this.#number, data, ports, numbers2)
      );
    }
    terminate() {
      natives.worker.terminate(this.#number);
    }
    // What the worker sent: `{ type, data, ports }` or `{ type: 'error', message }`.
    #receive({ type, data, ports, message }) {
      if (type === "error") {
        const event = new ErrorEvent("error", { message, cancelable: true });
        if (fire(this, event)) {
          console.error(`Uncaught (in worker) ${message}`);
        }
      } else {
        fire(this, new MessageEvent(type, { data, ports }));
      }
    }
  };
  defineEventHandlers(Worker.prototype, "message", "messageerror", "error");
  var SharedWorker = class extends EventTarget {
    static {
      __name(this, "SharedWorker");
    }
    #port;
    constructor(url, options) {
      super();
      const { type = "classic", name = "" } = typeof options === "string" ? { name: options } : options ?? {};
      if (type === "module") {
        throw new DOMException(
          "Unsupported SharedWorker: module workers are not supported.",
          "NotSupportedError"
        );
      }
      const { port1, port2 } = new MessageChannel();
      this.#port = port1;
      natives.worker.connect(
        String(url),
        String(name),
        takePort(port2),
        ({ message }) => {
          const event = new ErrorEvent("error", { message, cancelable: true });
          if (fire(this, event)) {
            console.error(`Uncaught (in shared worker) ${message}`);
          }
        }
      );
    }
    get port() {
      return this.#port;
    }
  };
  defineEventHandlers(SharedWorker.prototype, "error");
  setToStringTag(Worker, SharedWorker);
  function setupWorker(name, isShared) {
    const { close, importScripts } = natives.worker.self;
    inject(globalThis, { name, close, importScripts });
    if (isShared) {
      defineEventHandlers(globalThis, "connect");
      return (port) => fire(globalThis, new MessageEvent("connect", { data: "", ports: [port] }));
    } else {
      inject(globalThis, {
        postMessage(data, transfer) {
          postWith(
            transfer,
            (ports, numbers2) => natives.worker.self.postMessage(data, ports, numbers2)
          );
        }
      });
      defineEventHandlers(globalThis, "message", "messageerror");
      return ({ type, data, ports }) => fire(globalThis, new MessageEvent(type, { data, ports }));
    }
  }
  __name(setupWorker, "setupWorker");

  // src/xhr.js
  var xhr_exports = {};
  __export(xhr_exports, {
    XMLHttpRequest: () => XMLHttpRequest,
    XMLHttpRequestEventTarget: () => XMLHttpRequestEventTarget,
    XMLHttpRequestUpload: () => XMLHttpRequestUpload
  });
  var states4 = {
    UNSENT: 0,
    OPENED: 1,
    HEADERS_RECEIVED: 2,
    LOADING: 3,
    DONE: 4
  };
  var responseTypes = ["", "arraybuffer", "blob", "document", "json", "text"];
  var methods = ["DELETE", "GET", "HEAD", "OPTIONS", "POST", "PUT"];
  var forbiddenMethods = ["CONNECT", "TRACE", "TRACK"];
  var token = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
  var XMLHttpRequestEventTarget = class extends EventTarget {
    static {
      __name(this, "XMLHttpRequestEventTarget");
    }
    constructor(key) {
      checkInternal(
        key,
        "XMLHttpRequestEventTarget",
        "XMLHttpRequest and its upload are them"
      );
      super();
    }
  };
  var XMLHttpRequestUpload = class extends XMLHttpRequestEventTarget {
    static {
      __name(this, "XMLHttpRequestUpload");
    }
  };
  var XMLHttpRequest = class extends XMLHttpRequestEventTarget {
    static {
      __name(this, "XMLHttpRequest");
    }
    #readyState = states4.UNSENT;
    #method = "GET";
    #url = null;
    #headers = new Headers();
    #isSent = false;
    #isUploading = false;
    #timeout = 0;
    #withCredentials = false;
    #responseType = "";
    #mimeType = null;
    #upload = new XMLHttpRequestUpload(internal);
    // The request in flight, which a later one or `abort()` replaces, and how to
    // stop it:
    #request = null;
    #controller = null;
    #timer = null;
    // What came back: a `Response` without its body, the body's bytes, and what
    // `response` made of them.
    #response = null;
    #bytes = null;
    #value;
    constructor() {
      super(internal);
    }
    get readyState() {
      return this.#readyState;
    }
    get upload() {
      return this.#upload;
    }
    get timeout() {
      return this.#timeout;
    }
    set timeout(timeout) {
      this.#timeout = Math.max(0, Math.trunc(Number(timeout)) || 0);
    }
    // There are no cookies outside a browser; it's kept for libraries that ask.
    get withCredentials() {
      return this.#withCredentials;
    }
    set withCredentials(withCredentials) {
      if (this.#isSent || this.#readyState > states4.OPENED) {
        throw new DOMException(
          "Unable to set withCredentials: the request was sent.",
          "InvalidStateError"
        );
      }
      this.#withCredentials = !!withCredentials;
    }
    get responseType() {
      return this.#responseType;
    }
    set responseType(type) {
      this.#checkNotLoading("responseType");
      type = String(type);
      if (responseTypes.includes(type)) this.#responseType = type;
    }
    open(method, url, async = true, user, password) {
      checkArguments(arguments, 2, "open");
      method = String(method);
      if (!token.test(method)) {
        throw new DOMException(
          `Invalid XMLHttpRequest method: '${method}'.`,
          "SyntaxError"
        );
      }
      const upper = method.toUpperCase();
      if (forbiddenMethods.includes(upper)) {
        throw new DOMException(
          `Unsupported XMLHttpRequest method: '${method}'.`,
          "SecurityError"
        );
      }
      const base = globalThis.location?.href;
      url = String(url);
      if (!URL.canParse(url, base)) {
        throw new DOMException(
          `Invalid XMLHttpRequest URL: '${url}'.`,
          "SyntaxError"
        );
      }
      if (!async) {
        throw new DOMException(
          "Unsupported synchronous XMLHttpRequest: scripts can't wait for the network.",
          "InvalidAccessError"
        );
      }
      const parsed = new URL(url, base);
      if (user != null) parsed.username = user;
      if (password != null) parsed.password = password;
      this.#stop();
      this.#method = methods.includes(upper) ? upper : method;
      this.#url = parsed.href;
      this.#headers = new Headers();
      this.#isSent = false;
      this.#response = this.#bytes = null;
      this.#value = void 0;
      if (this.#readyState !== states4.OPENED) {
        this.#readyState = states4.OPENED;
        fire(this, new Event("readystatechange"));
      }
    }
    setRequestHeader(name, value) {
      checkArguments(arguments, 2, "setRequestHeader");
      this.#checkOpened("setRequestHeader");
      name = String(name);
      if (!token.test(name)) {
        throw new DOMException(
          `Invalid XMLHttpRequest header: '${name}'.`,
          "SyntaxError"
        );
      }
      const values = this.#headers.get(name);
      this.#headers.set(name, values === null ? value : `${values}, ${value}`);
    }
    send(body = null) {
      this.#checkOpened("send");
      if (this.#method === "GET" || this.#method === "HEAD") body = null;
      const request = this.#request = {};
      const controller = this.#controller = new AbortController();
      this.#isSent = true;
      this.#isUploading = body != null;
      fireProgress(this, "loadstart");
      if (this.#isUploading) fireProgress(this.#upload, "loadstart");
      if (this.#timeout > 0) {
        this.#timer = setTimeout(() => this.#fail("timeout"), this.#timeout);
      }
      const isCurrent = /* @__PURE__ */ __name(() => this.#request === request, "isCurrent");
      fetch(this.#url, {
        method: this.#method,
        headers: this.#headers,
        body,
        signal: controller.signal
      }).then(
        async (response) => {
          if (isCurrent()) {
            if (this.#isUploading) {
              this.#isUploading = false;
              for (const type of ["progress", "load", "loadend"]) {
                fireProgress(this.#upload, type);
              }
            }
            this.#response = response;
            this.#setState(states4.HEADERS_RECEIVED);
            const bytes = await response.bytes();
            if (isCurrent()) {
              this.#bytes = bytes;
              this.#setState(states4.LOADING);
              const { length } = bytes;
              fireProgress(this, "progress", length, length);
              this.#finish();
              this.#setState(states4.DONE);
              fireProgress(this, "load", length, length);
              fireProgress(this, "loadend", length, length);
            }
          }
        },
        () => {
          if (isCurrent()) this.#fail("error");
        }
      );
    }
    abort() {
      const state = this.#readyState;
      if (state === states4.OPENED && this.#isSent || state === states4.HEADERS_RECEIVED || state === states4.LOADING) {
        this.#fail("abort");
      } else {
        this.#stop();
      }
      if (this.#readyState === states4.DONE) {
        this.#readyState = states4.UNSENT;
        this.#response = this.#bytes = null;
      }
    }
    get status() {
      return this.#response?.status ?? 0;
    }
    get statusText() {
      return this.#response?.statusText ?? "";
    }
    get responseURL() {
      return this.#response?.url ?? "";
    }
    getResponseHeader(name) {
      checkArguments(arguments, 1, "getResponseHeader");
      return this.#response?.headers.get(name) ?? null;
    }
    // Sorted by name, in lower case, the values of a name joined:
    getAllResponseHeaders() {
      return [...this.#response?.headers ?? []].map(([name, value]) => `${name}: ${value}\r
`).join("");
    }
    overrideMimeType(mime) {
      checkArguments(arguments, 1, "overrideMimeType");
      this.#checkNotLoading("overrideMimeType");
      this.#mimeType = String(mime);
    }
    get responseText() {
      if (this.#responseType !== "" && this.#responseType !== "text") {
        throw new DOMException(
          `Unable to read responseText of a '${this.#responseType}' response.`,
          "InvalidStateError"
        );
      }
      return this.#bytes ? new TextDecoder().decode(this.#bytes) : "";
    }
    get response() {
      const type = this.#responseType;
      return type === "" || type === "text" ? this.responseText : this.#readyState !== states4.DONE ? null : this.#value === void 0 ? this.#value = this.#getResponse(type) : this.#value;
    }
    get responseXML() {
      const type = this.#responseType;
      if (type !== "" && type !== "document") {
        throw new DOMException(
          `Unable to read responseXML of a '${type}' response.`,
          "InvalidStateError"
        );
      }
      return this.#readyState !== states4.DONE ? null : this.#value === void 0 ? this.#value = this.#getDocument() : this.#value;
    }
    #getResponse(type) {
      const bytes = this.#bytes ?? new Uint8Array();
      switch (type) {
        case "json":
          try {
            return JSON.parse(new TextDecoder().decode(bytes));
          } catch {
            return null;
          }
        case "arraybuffer":
          return bytes.slice().buffer;
        case "blob":
          return new Blob([bytes], { type: this.#getMimeType() });
        case "document":
          return this.#getDocument();
      }
    }
    // XML as a document, and HTML when `responseType` asks for a document:
    #getDocument() {
      const mime = this.#getMimeType().split(";")[0].trim().toLowerCase();
      const kind = mime === "text/html" ? this.#responseType === "document" && "text/html" : (mime === "text/xml" || mime === "application/xml" || mime.endsWith("+xml")) && "text/xml";
      if (kind && this.#bytes) {
        try {
          const parser = new dom.window.DOMParser();
          return parser.parseFromString(this.responseText, kind);
        } catch {
          return null;
        }
      }
      return null;
    }
    // The overridden type, else the response's, else XML, as the standard has it:
    #getMimeType() {
      return this.#mimeType ?? this.#response?.headers.get("content-type") ?? "text/xml";
    }
    #setState(state) {
      this.#readyState = state;
      fire(this, new Event("readystatechange"));
    }
    #checkOpened(name) {
      if (this.#readyState !== states4.OPENED || this.#isSent) {
        throw new DOMException(
          `Unable to ${name}(): the request isn't opened, or was sent.`,
          "InvalidStateError"
        );
      }
    }
    #checkNotLoading(name) {
      if (this.#readyState >= states4.LOADING) {
        throw new DOMException(
          `Unable to set ${name}: the response is loading or loaded.`,
          "InvalidStateError"
        );
      }
    }
    // The request done, its timeout cleared:
    #finish() {
      clearTimeout(this.#timer);
      this.#request = this.#controller = this.#timer = null;
      this.#isSent = false;
    }
    // The request in flight stopped, without an event:
    #stop() {
      this.#controller?.abort();
      this.#finish();
    }
    // The request failed with `type`, 'error', 'abort' or 'timeout', as a network
    // error: no response, and events to say so.
    #fail(type) {
      const isUploading = this.#isUploading;
      this.#isUploading = false;
      this.#stop();
      this.#response = this.#bytes = null;
      this.#setState(states4.DONE);
      if (isUploading) {
        fireProgress(this.#upload, type);
        fireProgress(this.#upload, "loadend");
      }
      fireProgress(this, type);
      fireProgress(this, "loadend");
    }
  };
  defineConstants(XMLHttpRequest, states4);
  defineEventHandlers(
    XMLHttpRequestEventTarget.prototype,
    "loadstart",
    "progress",
    "abort",
    "error",
    "load",
    "timeout",
    "loadend"
  );
  defineEventHandlers(XMLHttpRequest.prototype, "readystatechange");
  setToStringTag(XMLHttpRequestEventTarget, XMLHttpRequestUpload, XMLHttpRequest);
  function fireProgress(target, type, loaded = 0, total = 0) {
    fire(
      target,
      new ProgressEvent(type, { lengthComputable: total > 0, loaded, total })
    );
  }
  __name(fireProgress, "fireProgress");

  // src/index.js
  delete globalThis.__scriptographer;
  var { print } = natives;
  var console2 = createConsole(print);
  inject(globalThis, { console: console2, print: console2.log });
  inject(
    globalThis,
    Object.fromEntries(
      Object.entries(global_scope_exports).filter(([name]) => !(name in globalThis))
    )
  );
  if (globalThis.navigator && !navigator.clipboard) {
    inject(globalThis, { Clipboard });
    inject(navigator, { clipboard: new Clipboard() }, { writable: false });
  }
  if (!globalThis.TextEncoder) {
    inject(globalThis, { TextEncoder: TextEncoder2, TextDecoder: TextDecoder2 });
  }
  if (!globalThis.ReadableStream) {
    inject(globalThis, { ...streams_exports });
  }
  if (!globalThis.CompressionStream) {
    inject(globalThis, { CompressionStream, DecompressionStream });
  }
  if (!globalThis.TextEncoderStream) {
    inject(globalThis, { TextEncoderStream, TextDecoderStream });
  }
  if (!globalThis.crypto) {
    inject(globalThis, { Crypto, crypto: new Crypto() });
  }
  if (!globalThis.DOMException) {
    inject(globalThis, { DOMException: DOMException2 });
  }
  if (!globalThis.EventTarget) {
    const { defineEventHandlers: defineEventHandlers2, fire: fire2, ...classes } = events_exports;
    const { prototype } = classes.EventTarget;
    inject(globalThis, {
      ...classes,
      addEventListener: prototype.addEventListener.bind(globalThis),
      removeEventListener: prototype.removeEventListener.bind(globalThis),
      dispatchEvent: prototype.dispatchEvent.bind(globalThis)
    });
    defineEventHandlers2(globalThis, "unhandledrejection", "rejectionhandled");
    Object.assign(natives, { notifyRejections });
  } else {
    reportRejections();
  }
  if (!globalThis.fetch) {
    const { Blob: Blob2, File: File2, getBytes: getBytes2 } = blob_exports;
    const { getBody: getBody2, ...classes } = fetch_exports;
    inject(globalThis, { ...abort_exports, Blob: Blob2, File: File2, ...classes });
    Object.assign(natives, { getBytes: getBytes2 });
  }
  if (!globalThis.XMLHttpRequest) {
    inject(globalThis, { ...xhr_exports });
  }
  if (!globalThis.localStorage) {
    inject(globalThis, {
      Storage,
      localStorage: createStorage(false),
      sessionStorage: createStorage(true)
    });
  }
  if (!globalThis.URL) {
    inject(globalThis, { URL: URL2, URLSearchParams: URLSearchParams2 });
  }
  if (!globalThis.URLPattern) {
    inject(globalThis, { URLPattern: Y2 });
  }
  if (!globalThis.WebSocket) {
    inject(globalThis, { WebSocket });
  }
  if (!globalThis.EventSource) {
    inject(globalThis, { EventSource });
  }
  if (!globalThis.Worker) {
    inject(globalThis, { Worker });
    Object.assign(natives, { setupWorker });
  }
  if (globalThis.navigator && !navigator.locks) {
    inject(globalThis, { Lock, LockManager });
    inject(navigator, { locks: new LockManager(internal) }, { writable: false });
  }
  if (!globalThis.SharedWorker) {
    inject(globalThis, { SharedWorker });
  }
  if (!globalThis.MessageChannel) {
    inject(globalThis, { MessageChannel, MessagePort });
    Object.assign(natives, { makePort });
  }
  if (!globalThis.BroadcastChannel) {
    inject(globalThis, { BroadcastChannel });
  }
  if (natives.dom && !globalThis.document) {
    inject(globalThis, dom, { configurable: true });
  }
  if (natives.fs) {
    const { getHandlePath: getHandlePath2, getDirectoryHandle: getDirectoryHandle2, ...classes } = file_system_exports;
    inject(globalThis, { LocalFile: LocalFile2, StorageManager, ...classes });
    inject(navigator, { storage: new StorageManager() }, { writable: false });
  }
  if (!globalThis.OffscreenCanvas) {
    inject(globalThis, { ...canvas_exports });
  }
  if (!globalThis.FontFace) {
    inject(globalThis, {
      FontFace,
      FontFaceSet,
      fonts: new FontFaceSet(internal)
    });
  }
  if (!globalThis.DOMMatrix) {
    const { getGeometryValues: getGeometryValues2, ...classes } = geometry_exports;
    inject(globalThis, { ...classes, WebKitCSSMatrix: DOMMatrix2 });
    Object.assign(natives, { getGeometryValues: getGeometryValues2 });
  }
  setupDialog(globalThis.Dialog ??= {});
  inject(globalThis, { Palette });
  Object.assign(natives, { takePalettes, hasPalettes, handlePaletteEvent });
})();
