#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

//! The same tests for every engine, through [`Runtime`].

use serde_json::Value;
use vectorcraft_scriptographer::{Engine, Runtime, Setup};

fn runs_paperscript_with_console_and_paper_globals<E: Engine>() {
    let mut runtime = Runtime::<E>::new().unwrap();
    let scope = runtime.create_scope(800.0, 600.0).unwrap();
    runtime
        .execute(
            &scope,
            "console.log('Hello World')\n\
             new Path.Circle({ center: view.bounds.center, radius: 100, fillColor: 'red' })",
        )
        .unwrap();
    assert_eq!(runtime.take_output(), ["Hello World"]);

    let project: Value = serde_json::from_str(&runtime.export_json(&scope).unwrap()).unwrap();
    assert_eq!(project[0][0], "Layer");
    let path = &project[0][1]["children"][0];
    assert_eq!(path[0], "Path");
    let path = &path[1];
    assert_eq!(path["fillColor"], serde_json::json!([1, 0, 0]));
    assert_eq!(path["closed"], true);

    // A circle of radius 100 around the view's centre (400, 300), drawn with four segments at the
    // left, top, right and bottom, with handles of 100 · 4(√2 − 1)/3 along the tangents. Each
    // segment is `[[x, y], [inX, inY], [outX, outY]]`.
    let k = 100.0 * 4.0 * (2f64.sqrt() - 1.0) / 3.0;
    let expected = [([300.0, 300.0], [0.0, k]), ([400.0, 200.0], [-k, 0.0]), ([500.0, 300.0], [0.0, -k]), ([400.0, 400.0], [k, 0.0])];
    let segments = path["segments"].as_array().unwrap();
    assert_eq!(segments.len(), 4);
    let number = |v: &Value| v.as_f64().unwrap();
    for (segment, (point, handle_in)) in segments.iter().zip(expected) {
        assert!((number(&segment[0][0]) - point[0]).abs() < 1e-9, "{segment}");
        assert!((number(&segment[0][1]) - point[1]).abs() < 1e-9, "{segment}");
        assert!((number(&segment[1][0]) - handle_in[0]).abs() < 1e-5, "{segment}");
        assert!((number(&segment[1][1]) - handle_in[1]).abs() < 1e-5, "{segment}");
        assert!((number(&segment[2][0]) + handle_in[0]).abs() < 1e-5, "{segment}");
        assert!((number(&segment[2][1]) + handle_in[1]).abs() < 1e-5, "{segment}");
    }
}

fn paperscript_operators_work_on_points<E: Engine>() {
    let mut runtime = Runtime::<E>::new().unwrap();
    let scope = runtime.create_scope(800.0, 600.0).unwrap();
    runtime.execute(&scope, "console.log(new Point(10, 20) + [1, 2], new Point(10, 20) * 2)").unwrap();
    assert_eq!(runtime.take_output(), ["{ x: 11, y: 22 } { x: 20, y: 40 }"]);
}

fn script_errors_are_returned<E: Engine>() {
    let mut runtime = Runtime::<E>::new().unwrap();
    let scope = runtime.create_scope(800.0, 600.0).unwrap();
    let error = runtime.execute(&scope, "undefinedFunction()").unwrap_err();
    assert!(error.to_string().contains("undefinedFunction"), "{error}");
}

fn host_function_errors_are_thrown_in_scripts<E: Engine>() {
    let mut runtime = Runtime::<E>::new().unwrap();
    let scope = runtime.create_scope(800.0, 600.0).unwrap();
    runtime.execute(&scope, "try { setInterval(42) } catch (e) { console.log(e.message) }").unwrap();
    assert_eq!(runtime.take_output(), ["setInterval: the callback is not a function"]);
}

fn intervals_run_when_due<E: Engine>() {
    let mut runtime = Runtime::<E>::new().unwrap();
    let scope = runtime.create_scope(800.0, 600.0).unwrap();
    runtime
        .execute(
            &scope,
            "var count = 0\n\
             var id = setInterval(function() { console.log(++count); if (count == 3) clearInterval(id) }, 10)",
        )
        .unwrap();
    for now in [5.0, 10.0, 15.0, 20.0, 45.0, 50.0, 100.0] {
        runtime.run_timers(now).unwrap();
    }
    // Due at 10, 20 and 30; the one missed until 45 runs once, then the interval is cleared.
    assert_eq!(runtime.take_output(), ["1", "2", "3"]);
}

fn timeouts_run_once<E: Engine>() {
    let mut runtime = Runtime::<E>::new().unwrap();
    let scope = runtime.create_scope(800.0, 600.0).unwrap();
    runtime
        .execute(
            &scope,
            "setTimeout(function() { print('soon') }, 10)\n\
             setTimeout(function() { console.warn('later') }, 100)\n\
             var cleared = setTimeout(function() { print('never') }, 20)\n\
             clearTimeout(cleared)",
        )
        .unwrap();
    for now in [5.0, 10.0, 15.0, 50.0] {
        runtime.run_timers(now).unwrap();
    }
    assert_eq!(runtime.take_output(), ["soon"], "the later one waits, even past its own delay from now");
    assert!(runtime.is_running());
    runtime.run_timers(100.0).unwrap();
    runtime.run_timers(200.0).unwrap();
    assert_eq!(runtime.take_output(), ["later"]);
    assert!(!runtime.is_running(), "nothing is left once the timeouts ran");
}

fn animation_frames_run_once_a_frame<E: Engine>() {
    let mut runtime = Runtime::<E>::new().unwrap();
    let scope = runtime.create_scope(800.0, 600.0).unwrap();
    runtime
        .execute(
            &scope,
            "let frames = 0\n\
             function frame(time) { print('frame', time); if (++frames < 2) requestAnimationFrame(frame) }\n\
             requestAnimationFrame(frame)\n\
             cancelAnimationFrame(requestAnimationFrame(() => print('never')))",
        )
        .unwrap();
    assert!(runtime.is_running(), "a frame is waiting");
    runtime.run_timers(16.0).unwrap();
    assert_eq!(runtime.take_output(), ["frame 16"], "the one it asks for runs on the next frame");
    runtime.run_timers(32.0).unwrap();
    assert_eq!(runtime.take_output(), ["frame 32"]);
    assert!(!runtime.is_running());
}

fn local_files_read_write_and_list<E: Engine>(name: &str) {
    let folder = std::env::temp_dir().join(format!("scriptographer-files-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&folder);
    std::fs::create_dir_all(&folder).unwrap();
    let mut runtime = Runtime::<E>::new().unwrap();
    runtime.set_script(&Setup { file: Some(folder.join("script.js").to_string_lossy().into_owned()), ..Setup::default() }).unwrap();
    let scope = runtime.create_scope(800.0, 600.0).unwrap();
    let script = "const notes = new LocalFile('notes.txt')\n\
         console.log(notes instanceof File, notes instanceof Blob, await notes.exists(), notes.name, notes.extension, notes.type, notes.parent.path == script.directory.path)\n\
         try { await notes.text() } catch (e) { console.log(e.name) }\n\
         await notes.write('one\\n')\n\
         await notes.append(new Blob(['two']))\n\
         console.log(await notes.exists(), notes.size, await notes.text(), (await notes.bytes()).length, (await notes.arrayBuffer()).byteLength, await notes.slice(-3).text())\n\
         console.log(await new Response(notes).text() == await notes.text(), (await new Response(new FormData()).text()).length >= 0)\n\
         const sub = await script.directory.file('sub')\n\
         await sub.makeDirectory()\n\
         const copy = await notes.copyTo(new LocalFile(script.directory, 'sub', 'copy.txt'))\n\
         console.log(sub.isDirectory, copy.path == sub.path + '/copy.txt', (await script.directory.list()).map(f => f.name).join())\n\
         await copy.rename('moved.txt')\n\
         console.log(copy.name, (await sub.list()).map(f => f.name).join())\n\
         try { await sub.remove() } catch (e) { console.log(e.name) }\n\
         await sub.remove({ recursive: true })\n\
         console.log(await sub.exists(), String(notes) == notes.path, script.file.name, Object.prototype.toString.call(notes))";
    runtime.execute(&scope, &format!("(async () => {{ try {{ {script} }} catch (e) {{ console.log('error', e.name, e.message) }} }})()")).unwrap();
    settle(&mut runtime);
    assert_eq!(
        runtime.take_output(),
        [
            "true true false notes.txt txt text/plain true",
            "NotFoundError",
            "true 7 one\ntwo 7 7 two",
            "true true",
            "true true notes.txt,sub",
            "moved.txt moved.txt",
            "InvalidModificationError",
            "false true script.js [object LocalFile]"
        ]
    );
    std::fs::remove_dir_all(&folder).unwrap();
}

fn scripts_await_at_the_top_level<E: Engine>() {
    let mut runtime = Runtime::<E>::new().unwrap();
    let scope = runtime.create_scope(800.0, 600.0).unwrap();
    runtime.execute(&scope, "const two = await Promise.resolve(2)\nconsole.log(two)\nfunction onStop() { console.log('stopped') }").unwrap();
    runtime.run_timers(0.0).unwrap();
    assert!(runtime.call_handler("onStop").unwrap(), "its handlers, once it has finished");
    assert_eq!(runtime.take_output(), ["2", "stopped"]);
    let failure = runtime.execute(&scope, "await null\nthrow new Error('now')").unwrap_err();
    assert!(failure.to_string().contains("now"), "a failure before it returns is its error: {failure}");
    runtime.execute(&scope, "await new Promise(resolve => setTimeout(resolve, 0))\nthrow new Error('later')").unwrap();
    let failure = runtime.run_timers(1.0).unwrap_err();
    assert!(failure.to_string().contains("later"), "a failure in a frame is the frame's error: {failure}");
}

/// V8's `WebAssembly`, its Promises too (Boa has none; browsers their own).
#[cfg(all(feature = "v8", not(target_arch = "wasm32")))]
#[test]
fn scripts_run_webassembly() {
    let mut runtime = Runtime::<vectorcraft_scriptographer::V8>::new().unwrap();
    let scope = runtime.create_scope(800.0, 600.0).unwrap();
    // A module exporting `answer()`, which returns 42.
    let script = "const bytes = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 127, 3, 2, 1, 0, 7, 10, 1, 6, 97, 110, 115, 119, 101, 114, 0, 0, 10, 6, 1, 4, 0, 65, 42, 11])\n\
         console.log(typeof WebAssembly)\n\
         const module = new WebAssembly.Module(bytes)\n\
         console.log(new WebAssembly.Instance(module).exports.answer())\n\
         const { instance } = await WebAssembly.instantiate(bytes)\n\
         console.log(instance.exports.answer() + 1)";
    runtime.execute(&scope, &format!("(async () => {{ try {{ {script} }} catch (e) {{ console.log('error', e.name, e.message) }} }})()")).unwrap();
    settle(&mut runtime);
    assert_eq!(runtime.take_output(), ["object", "42", "43"]);
}

fn host_classes_can_be_subclassed<E: Engine>() {
    let mut runtime = Runtime::<E>::new().unwrap();
    let scope = runtime.create_scope(800.0, 600.0).unwrap();
    let script = "const classes = [[Blob, [['a']]], [File, [['a'], 'a.txt']], [LocalFile, ['a.txt']], [Headers, []], [Request, ['https://example.com/']],\n\
         [Response, ['x']], [FormData, []], [AbortController, []], [OffscreenCanvas, [2, 2]], [ImageData, [1, 1]], [Path2D, []], [DOMMatrix, []],\n\
         [DOMPoint, [1, 2]], [DOMRect, [0, 0, 1, 1]], [DOMQuad, []], [URL, ['https://example.com/a']], [URLSearchParams, ['a=1']],\n\
         [TextEncoder, []], [TextDecoder, []], [DOMException, ['m', 'NotFoundError']], [EventTarget, []], [Event, ['e']]]\n\
         const failed = classes.filter(([Base, args]) => {\n\
             class Sub extends Base { mine() { return 'mine' } }\n\
             const made = new Sub(...args)\n\
             return !(made instanceof Sub && made instanceof Base && made.mine() == 'mine')\n\
         }).map(([Base]) => Base.name)\n\
         console.log(failed.join() || 'all')\n\
         class Text extends Blob { get length() { return this.size } }\n\
         class Address extends URL { get file() { return this.pathname.split('/').pop() } }\n\
         class Spot extends DOMPoint { get sum() { return this.x + this.y } }\n\
         class Missing extends DOMException {}\n\
         console.log(new Text(['abc']).length, new Address('https://a.b/c/d.txt').file, new Spot(1, 2).sum, new Missing('gone', 'NotFoundError').code)\n\
         try { Blob(['a']) } catch (e) { console.log(e.name) }";
    runtime.execute(&scope, script).unwrap();
    assert_eq!(runtime.take_output(), ["all", "3 d.txt 3 8", "TypeError"]);
}

fn web_imports_are_kept_for_the_next_run<E: Engine>(name: &str) {
    let address = serve(2);
    let cache = std::env::temp_dir().join(format!("scriptographer-cache-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&cache);
    let run = || {
        let mut runtime = Runtime::<E>::new().unwrap();
        runtime.set_script(&Setup { cache: Some(cache.clone()), ..Setup::default() }).unwrap();
        let scope = runtime.create_scope(800.0, 600.0).unwrap();
        runtime.execute(&scope, &format!("import {{ kept }} from '{address}/kept.js'\nconsole.log(kept)")).unwrap();
        runtime.take_output().into_iter().filter(|line| !line.starts_with("import ")).collect::<Vec<_>>()
    };
    assert_eq!(run(), ["once"], "downloaded, and kept");
    assert_eq!(run(), ["once"], "the copy, which the server says is still the one");
    assert_eq!(run(), ["once"], "the copy, with the server gone");
    std::fs::remove_dir_all(&cache).unwrap();
}

fn files_are_blobs_with_a_name<E: Engine>() {
    let mut runtime = Runtime::<E>::new().unwrap();
    let scope = runtime.create_scope(800.0, 600.0).unwrap();
    let script = "const file = new File(['<svg/>'], 'dot.svg', { type: 'Image/SVG+XML', lastModified: 42 })\n\
         console.log(file instanceof Blob, File.prototype instanceof Blob, file.name, file.type, file.size, file.lastModified, await file.text())\n\
         try { File(['a'], 'a.txt') } catch (e) { console.log(e.name) }\n\
         try { new File(['a']) } catch (e) { console.log(e.name) }";
    runtime.execute(&scope, &format!("(async () => {{ try {{ {script} }} catch (e) {{ console.log('error', e.name, e.message) }} }})()")).unwrap();
    settle(&mut runtime);
    assert_eq!(runtime.take_output(), ["true true dot.svg image/svg+xml 6 42 <svg/>", "TypeError", "TypeError"]);
}

fn scripts_have_a_dom<E: Engine>() {
    let mut runtime = Runtime::<E>::new().unwrap();
    let scope = runtime.create_scope(800.0, 600.0).unwrap();
    runtime
        .execute(
            &scope,
            "var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')\n\
             document.body.appendChild(svg)\n\
             svg.setAttribute('width', '20')\n\
             var clicks = 0\n\
             svg.addEventListener('click', function() { clicks++ })\n\
             svg.dispatchEvent(new window.Event('click'))\n\
             console.log(document.querySelector('svg') === svg, svg.namespaceURI, clicks, document.body.innerHTML)\n\
             console.log(atob(btoa('hé')), atob('aGk'))",
        )
        .unwrap();
    assert_eq!(runtime.take_output(), ["true http://www.w3.org/2000/svg 1 <svg width=\"20\" />", "hé hi"]);
}

/// A key typed on the canvas goes to the script's `document` and bubbles up to its `window`, which
/// is the global object's events, with `onkeydown` too, as in a browser.
fn keys_reach_the_document_and_the_window<E: Engine>() {
    use vectorcraft_scriptographer::{Key, Modifiers};
    let mut runtime = Runtime::<E>::new().unwrap();
    let scope = runtime.create_scope(800.0, 600.0).unwrap();
    let key = |down| Key { down, key: "A".into(), code: "KeyA".into(), repeat: false, modifiers: Modifiers { shift: true, ..Default::default() } };
    assert!(!runtime.has_key_listeners().unwrap());
    // Before a script reads `document`, the window gets the key:
    runtime
        .execute(
            &scope,
            "globalThis.up = e => console.log('up', e instanceof KeyboardEvent, e.key, e.code, e.shiftKey, e.getModifierState('Shift'))\n\
             addEventListener('keyup', up)",
        )
        .unwrap();
    assert!(runtime.has_key_listeners().unwrap(), "a listener keeps the script running");
    assert!(!runtime.document_key(&key(false)).unwrap(), "nothing prevented its default");
    assert_eq!(runtime.take_output(), ["up true A KeyA true true"]);
    runtime.execute(&scope, "removeEventListener('keyup', up)").unwrap();
    assert!(!runtime.has_key_listeners().unwrap(), "without it, the script ends");
    runtime
        .execute(
            &scope,
            "console.log(window.addEventListener === addEventListener)\n\
             document.addEventListener('keydown', e => console.log('document', e.key, e.code, e.shiftKey, e.getModifierState('Shift')))\n\
             window.addEventListener('keydown', e => console.log('window', e.key))\n\
             window.onkeydown = e => console.log('onkeydown', e.repeat)",
        )
        .unwrap();
    runtime.document_key(&key(true)).unwrap();
    assert_eq!(runtime.take_output(), ["true", "document A KeyA true true", "window A", "onkeydown false"]);
    runtime.execute(&scope, "document.addEventListener('keydown', e => e.stopPropagation())").unwrap();
    assert!(!runtime.document_key(&key(true)).unwrap());
    assert_eq!(runtime.take_output(), ["document A KeyA true true"], "stopped on the document");
    runtime.execute(&scope, "document.addEventListener('keydown', e => e.preventDefault())").unwrap();
    assert!(runtime.document_key(&key(true)).unwrap(), "prevented on the document");
    runtime.execute(&scope, "addEventListener('keyup', e => e.preventDefault())").unwrap();
    assert!(runtime.document_key(&key(false)).unwrap(), "and on the window");
    runtime.take_output();
}

/// A `once` key listener keeps a script running until its key comes, one with a signal until the
/// signal aborts, and removing a listener takes the one with the same capture only.
fn key_listeners_keep_a_script_running_as_long_as_they_listen<E: Engine>() {
    use vectorcraft_scriptographer::{Key, Modifiers};
    let mut runtime = Runtime::<E>::new().unwrap();
    let scope = runtime.create_scope(800.0, 600.0).unwrap();
    let key = Key { down: true, key: "a".into(), code: "KeyA".into(), repeat: false, modifiers: Modifiers::default() };
    runtime.execute(&scope, "document.addEventListener('keydown', e => console.log('once'), { once: true })").unwrap();
    assert!(runtime.has_key_listeners().unwrap());
    runtime.document_key(&key).unwrap();
    assert_eq!(runtime.take_output(), ["once"]);
    assert!(!runtime.has_key_listeners().unwrap(), "it went with its key");
    runtime
        .execute(&scope, "globalThis.controller = new AbortController()\naddEventListener('keydown', e => {}, { signal: controller.signal })")
        .unwrap();
    assert!(runtime.has_key_listeners().unwrap());
    runtime.execute(&scope, "controller.abort()").unwrap();
    assert!(!runtime.has_key_listeners().unwrap(), "it went with its signal");
    runtime.execute(&scope, "globalThis.down = e => {}\naddEventListener('keydown', down, true)\nremoveEventListener('keydown', down)").unwrap();
    assert!(runtime.has_key_listeners().unwrap(), "removing the one without capture left the one with it");
    runtime.execute(&scope, "removeEventListener('keydown', down, { capture: true })").unwrap();
    assert!(!runtime.has_key_listeners().unwrap());
}

/// An `on…` handler is a listener, as the HTML standard has it: it sees the event's target, runs in
/// the order it was first set, gets the events a script dispatches, and `false` cancels.
fn event_handlers_are_listeners<E: Engine>() {
    let mut runtime = Runtime::<E>::new().unwrap();
    let scope = runtime.create_scope(800.0, 600.0).unwrap();
    runtime
        .execute(
            &scope,
            "var controller = new AbortController(), signal = controller.signal, log = []\n\
             signal.addEventListener('abort', () => log.push('first'))\n\
             signal.onabort = () => log.push('replaced')\n\
             signal.addEventListener('abort', () => log.push('last'))\n\
             signal.onabort = e => log.push('handler ' + (e.target === signal) + ' ' + (e.currentTarget === signal))\n\
             controller.abort()\n\
             signal.onabort = () => false\n\
             console.log(log.join(', '), signal.dispatchEvent(new Event('abort', { cancelable: true })))\n\
             signal.onabort = null\n\
             console.log(signal.onabort, signal.dispatchEvent(new Event('abort', { cancelable: true })))\n\
             try { new EventTarget().addEventListener('x', () => {}, { signal: { aborted: false, addEventListener() {} } }) } catch (e) { console.log(e.name) }",
        )
        .unwrap();
    assert_eq!(runtime.take_output(), ["first, handler true true, last false", "null true", "TypeError"]);
}

/// `new ImageData(data, width[, height])` takes whole pixels that fill whole rows, as browsers do.
fn image_data_takes_whole_rows<E: Engine>() {
    let mut runtime = Runtime::<E>::new().unwrap();
    let scope = runtime.create_scope(800.0, 600.0).unwrap();
    runtime
        .execute(
            &scope,
            "const name = (...args) => { try { return new ImageData(...args).height } catch (e) { return e.name } }\n\
             console.log(name(new Uint8ClampedArray(24), 3), name(new Uint8ClampedArray(8), 3), name(new Uint8ClampedArray(6), 1), name(new Uint8ClampedArray(0), 1), name(new Uint8ClampedArray(24), 3, 1))",
        )
        .unwrap();
    assert_eq!(runtime.take_output(), ["2 IndexSizeError InvalidStateError InvalidStateError IndexSizeError"]);
}

fn scripts_use_todays_javascript<E: Engine>() {
    let mut runtime = Runtime::<E>::new().unwrap();
    let scope = runtime.create_scope(800.0, 600.0).unwrap();
    runtime
        .execute(
            &scope,
            "const add = (a, b) => a + b\n\
             class Dot { constructor(at) { this.at = at } }\n\
             let [x, y] = [1, 2]\n\
             const dot = new Dot(new Point(x, y) * 2)\n\
             console.log(`${add(1, 2)}`, dot.at + [x, y], dot?.missing?.value ?? 'none')",
        )
        .unwrap();
    assert_eq!(runtime.take_output(), ["3 { x: 3, y: 6 } none"]);
}

fn promises_resolve<E: Engine>() {
    let mut runtime = Runtime::<E>::new().unwrap();
    let scope = runtime.create_scope(800.0, 600.0).unwrap();
    runtime.execute(&scope, "Promise.resolve(2).then(n => console.log('then', n))\nconsole.log('first')").unwrap();
    assert_eq!(runtime.take_output(), ["first", "then 2"], "after the script, before the host goes on");
}

/// A rejection nothing handled once the microtasks ran fires `unhandledrejection` at the global
/// object, and shows in the console unless a listener prevents it; handled later, it fires
/// `rejectionhandled`.
fn unhandled_rejections_are_reported<E: Engine>() {
    let mut runtime = Runtime::<E>::new().unwrap();
    let scope = runtime.create_scope(800.0, 600.0).unwrap();
    runtime
        .execute(
            &scope,
            "onunhandledrejection = event => console.log('handler', event.reason, event.cancelable, event instanceof PromiseRejectionEvent)\n\
             addEventListener('unhandledrejection', event => event.reason === 'quiet' && event.preventDefault())\n\
             addEventListener('rejectionhandled', event => console.log('handled', event.reason, event.promise === late))\n\
             Promise.reject('lost')\n\
             Promise.reject('caught').catch(() => {})\n\
             globalThis.late = Promise.reject('quiet')\n\
             console.log('script')",
        )
        .unwrap();
    assert_eq!(
        runtime.take_output(),
        ["script", "handler lost true true", "Uncaught (in promise) lost", "handler quiet true true"],
        "after the microtasks, those handled in time left out"
    );
    runtime.eval("late.catch(() => {})").unwrap();
    assert_eq!(runtime.take_output(), ["handled quiet true"]);
}

/// A `BroadcastChannel` message reaches the other channels of its name, in any runtime, on their
/// turn: in the order the messages were posted, and to the channels in the order they were opened.
fn broadcast_channels_reach_the_others_of_their_name<E: Engine>(engine: &str) {
    let name = format!("broadcast-{engine}");
    let mut first = Runtime::<E>::new().unwrap();
    let scope = first.create_scope(800.0, 600.0).unwrap();
    first
        .execute(
            &scope,
            &format!(
                "const log = label => event => console.log(label, JSON.stringify(event.data), event instanceof MessageEvent)\n\
                 globalThis.one = new BroadcastChannel('{name}')\n\
                 globalThis.two = new BroadcastChannel('{name}')\n\
                 const other = new BroadcastChannel('{name}-other')\n\
                 one.onmessage = log('one')\n\
                 two.addEventListener('message', log('two'))\n\
                 other.onmessage = log('other')\n\
                 one.postMessage({{ n: 1 }})"
            ),
        )
        .unwrap();
    let mut second = Runtime::<E>::new().unwrap();
    let scope = second.create_scope(800.0, 600.0).unwrap();
    second
        .execute(&scope, &format!("const three = new BroadcastChannel('{name}')\nthree.onmessage = event => console.log('three', event.data)\nthree.postMessage('hi')\nthree.close()"))
        .unwrap();
    assert!(first.take_output().is_empty(), "on the receiver's turn");
    first.run_timers(0.0).unwrap();
    second.run_timers(0.0).unwrap();
    assert_eq!(first.take_output(), ["two {\"n\":1} true", "one \"hi\" true", "two \"hi\" true"]);
    assert!(second.take_output().is_empty(), "the one opened after the post gets nothing, nor the one closed");
    // A runtime without PaperScript, whose view would wait for a frame:
    let mut third = Runtime::<E>::new().unwrap();
    third.eval(&format!("globalThis.channel = new BroadcastChannel('{name}')")).unwrap();
    assert!(third.is_running(), "an open channel keeps its script running");
    third.eval("channel.close()").unwrap();
    assert!(!third.is_running());
    first.eval("one.close(); two.close(); try { one.postMessage(1) } catch (e) { console.log(e.name, one.name === two.name) }").unwrap();
    assert_eq!(first.take_output(), ["InvalidStateError true"]);
}

fn scripts_have_the_browsers_everyday_apis<E: Engine>() {
    let mut runtime = Runtime::<E>::new().unwrap();
    let scope = runtime.create_scope(800.0, 600.0).unwrap();
    runtime
        .execute(
            &scope,
            "const bytes = new TextEncoder().encode('hé')\n\
             console.log(bytes.length, new TextDecoder().decode(bytes), new TextDecoder('utf-8').decode(bytes.buffer))\n\
             const random = crypto.getRandomValues(new Uint32Array(4))\n\
             console.log(random.length, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(crypto.randomUUID()))\n\
             const t = performance.now()\n\
             console.log(t >= 0 && performance.now() >= t)\n\
             queueMicrotask(() => console.log('microtask'))\n\
             const kept = ['EventTarget', 'OffscreenCanvas', 'URL'].map(name => Object.getOwnPropertyDescriptor(globalThis, name))\n\
             console.log(kept.every(global => global.writable && !global.enumerable), Object.prototype.toString.call(new ImageData(1, 1)))\n\
             console.log('script')",
        )
        .unwrap();
    assert_eq!(
        runtime.take_output(),
        ["3 hé hé", "4 true", "true", "true [object ImageData]", "script", "microtask"],
        "the globals are the realm's kind: values scripts can set, not listed"
    );
}

/// Streams, as the Streams standard has them: a blob's bytes, through the encoding streams and a
/// transform of the script's own.
fn streams_pipe_through_transforms<E: Engine>() {
    let mut runtime = Runtime::<E>::new().unwrap();
    let scope = runtime.create_scope(800.0, 600.0).unwrap();
    runtime
        .execute(
            &scope,
            "const upper = new TransformStream({ transform: (chunk, controller) => controller.enqueue(chunk.toUpperCase()) })\n\
             const stream = new Blob(['hé', 'llo']).stream().pipeThrough(new TextDecoderStream()).pipeThrough(upper)\n\
             const chunks = []\n\
             for await (const chunk of stream) chunks.push(chunk)\n\
             const encoded = ReadableStream.from(['\\ud83d', '\\ude00']).pipeThrough(new TextEncoderStream())\n\
             const parts = []\n\
             for await (const part of encoded) parts.push([...part].join())\n\
             console.log(chunks.join('|'), parts.join('|'))",
        )
        .unwrap();
    assert_eq!(runtime.take_output(), ["HÉLLO 240,159,152,128"], "a surrogate pair split across chunks is one character");
}

/// Compression streams round-trip each format, and a decoder fails on data that ended early.
fn compression_streams_round_trip<E: Engine>() {
    let mut runtime = Runtime::<E>::new().unwrap();
    let scope = runtime.create_scope(800.0, 600.0).unwrap();
    runtime
        .execute(
            &scope,
            "const text = 'Scriptographer '.repeat(100)\n\
             const through = (bytes, stream) => new Response(new Blob([bytes]).stream().pipeThrough(stream)).bytes()\n\
             for (const format of ['gzip', 'deflate', 'deflate-raw', 'brotli']) {\n\
               const packed = await through(new TextEncoder().encode(text), new CompressionStream(format))\n\
               const unpacked = new TextDecoder().decode(await through(packed, new DecompressionStream(format)))\n\
               const cut = await through(packed.slice(0, -4), new DecompressionStream(format)).catch(e => e.name)\n\
               console.log(format, packed.length < text.length, unpacked === text, cut)\n\
             }\n\
             console.log((() => { try { new CompressionStream('zip') } catch (e) { return e.name } })())",
        )
        .unwrap();
    assert_eq!(
        runtime.take_output(),
        ["gzip true true TypeError", "deflate true true TypeError", "deflate-raw true true TypeError", "brotli true true TypeError", "TypeError"]
    );
}

/// `URLPattern` matches URLs and gives the groups it matched.
fn url_patterns_match_urls<E: Engine>() {
    let mut runtime = Runtime::<E>::new().unwrap();
    let scope = runtime.create_scope(800.0, 600.0).unwrap();
    runtime
        .execute(
            &scope,
            "const pattern = new URLPattern({ pathname: '/books/:id(\\\\d+)' })\n\
             const match = pattern.exec('https://example.com/books/42')\n\
             console.log(pattern.test('https://example.com/books/x'), match.pathname.groups.id, new URLPattern('https://*.example.com/*').test('https://a.example.com/b'))",
        )
        .unwrap();
    assert_eq!(runtime.take_output(), ["false 42 true"]);
}

/// `navigator.storage.getDirectory()` is the script's own folder, which the app keeps for it next
/// to its `localStorage`, there again the next time it runs; code typed in the console has none.
fn scripts_keep_their_own_files<E: Engine>(name: &str) {
    let folder = std::env::temp_dir().join(format!("scriptographer-own-files-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&folder);
    let run = |setup: Setup, source: &str| {
        let mut runtime = Runtime::<E>::new().unwrap();
        runtime.set_script(&setup).unwrap();
        let scope = runtime.create_scope(800.0, 600.0).unwrap();
        runtime.execute(&scope, source).unwrap();
        runtime.take_output()
    };
    let setup =
        Setup { file: Some(folder.join("script.js").to_string_lossy().into_owned()), storage: Some(folder.join("storage")), ..Setup::default() };
    let written = run(
        setup.clone(),
        "const root = await navigator.storage.getDirectory()\n\
         const file = await root.getFileHandle('notes.txt', { create: true })\n\
         const writable = await file.createWritable()\n\
         await writable.write('hello')\n\
         await writable.close()\n\
         const { usage } = await navigator.storage.estimate()\n\
         console.log(usage >= 5, await navigator.storage.persisted(), navigator.storage instanceof StorageManager)",
    );
    assert_eq!(written, ["true true true"]);
    let read = run(
        setup.clone(),
        "const root = await navigator.storage.getDirectory()\nconsole.log(await (await (await root.getFileHandle('notes.txt')).getFile()).text())",
    );
    assert_eq!(read, ["hello"], "the next time it runs");
    // Its workers share it, a shared worker has none:
    std::fs::create_dir_all(&folder).unwrap();
    std::fs::write(
        folder.join("reader.js"),
        "const read = async () => { const root = await navigator.storage.getDirectory(); return (await (await root.getFileHandle('notes.txt')).getFile()).text() }\n\
         onmessage = async () => postMessage(await read())\n\
         onconnect = async event => event.ports[0].postMessage(await read().catch(e => e.name))",
    )
    .unwrap();
    let mut runtime = Runtime::<E>::new().unwrap();
    runtime.set_script(&setup).unwrap();
    runtime
        .eval(
            "const worker = new Worker('reader.js')\n\
             worker.onmessage = event => { console.log('worker', event.data); worker.terminate() }\n\
             worker.postMessage('read')\n\
             const shared = new SharedWorker('reader.js')\n\
             shared.port.onmessage = event => { console.log('shared', event.data); shared.port.close() }",
        )
        .unwrap();
    run_until_done(&mut runtime);
    let mut heard = runtime.take_output();
    heard.sort();
    assert_eq!(heard, ["shared SecurityError", "worker hello"]);
    let typed = run(Setup::default(), "console.log(await navigator.storage.getDirectory().catch(e => e.name))");
    assert_eq!(typed, ["SecurityError"]);
}

/// Web Locks are the app's: a lock one script holds, another one waits for, unless it asks only
/// if it's available; shared ones are held together.
fn locks_are_shared_by_scripts<E: Engine>(name: &str) {
    let lock = format!("lock-{name}");
    let mut first = Runtime::<E>::new().unwrap();
    first
        .eval(&format!(
            "navigator.locks.request('{lock}', async lock => {{\n\
               console.log('first', lock.mode, lock instanceof Lock)\n\
               await new Promise(resolve => setTimeout(resolve, 50))\n\
               console.log('first done')\n\
             }})"
        ))
        .unwrap();
    first.run_timers(0.0).unwrap();
    let mut second = Runtime::<E>::new().unwrap();
    second
        .eval(&format!(
            "navigator.locks.request('{lock}', {{ ifAvailable: true }}, lock => console.log('available', lock))\n\
             navigator.locks.request('{lock}', lock => 'got it').then(result => console.log('second', result))\n\
             Promise.all(['a', 'b'].map(id => navigator.locks.request('{lock}-shared', {{ mode: 'shared' }}, () => navigator.locks.query())))\n\
               .then(([state]) => console.log('shared', state.held.filter(h => h.name === '{lock}-shared').length))"
        ))
        .unwrap();
    second.run_timers(0.0).unwrap();
    assert!(second.is_running(), "a request that waits keeps the script running");
    let started = std::time::Instant::now();
    while (first.is_running() || second.is_running()) && started.elapsed() < std::time::Duration::from_secs(5) {
        let now = started.elapsed().as_secs_f64() * 1000.0;
        first.run_timers(now).unwrap();
        second.run_timers(now).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(5));
    }
    assert_eq!(first.take_output(), ["first exclusive true", "first done"]);
    assert_eq!(second.take_output(), ["available null", "shared 2", "second got it"]);
    // A script that ends lets go of what it holds:
    let mut holder = Runtime::<E>::new().unwrap();
    holder.eval(&format!("navigator.locks.request('{lock}-kept', () => new Promise(() => {{}}))")).unwrap();
    holder.run_timers(0.0).unwrap();
    second.eval(&format!("navigator.locks.request('{lock}-kept', () => console.log('freed'))")).unwrap();
    second.run_timers(0.0).unwrap();
    assert!(second.take_output().is_empty());
    drop(holder);
    second.run_timers(0.0).unwrap();
    second.run_timers(0.0).unwrap();
    assert_eq!(second.take_output(), ["freed"]);
}

/// Encoding as the Encoding standard has it, and base64 as browsers read it.
fn text_encodes_as_the_standard_has_it<E: Engine>() {
    let mut runtime = Runtime::<E>::new().unwrap();
    let scope = runtime.create_scope(800.0, 600.0).unwrap();
    runtime
        .execute(
            &scope,
            "const thrown = f => { try { return f() } catch (e) { return e.name } }\n\
             const streamed = new TextDecoder()\n\
             console.log(streamed.decode(new Uint8Array([0xef, 0xbb, 0xbf, 0x68, 0xc3]), { stream: true }) + streamed.decode(new Uint8Array([0xa9])))\n\
             console.log(new TextDecoder('utf-8', { ignoreBOM: true }).decode(new Uint8Array([0xef, 0xbb, 0xbf])).length, new TextDecoder().decode(new Uint8Array([0xff])))\n\
             console.log(thrown(() => new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array([0xff]))), thrown(() => new TextDecoder('latin1')))\n\
             const into = new Uint8Array(3)\n\
             console.log(JSON.stringify(new TextEncoder().encodeInto('aé€', into)), into.join())\n\
             console.log(atob(' aG k= '), btoa('ab'), thrown(() => atob('a')), thrown(() => btoa('€')))\n\
             console.log(thrown(() => crypto.getRandomValues(new Float32Array(1))))",
        )
        .unwrap();
    assert_eq!(
        runtime.take_output(),
        [
            "hé",
            "1 \u{fffd}",
            "TypeError RangeError",
            "{\"read\":2,\"written\":3} 97,195,169",
            "hi YWI= InvalidCharacterError InvalidCharacterError",
            "TypeMismatchError"
        ]
    );
}

fn scripts_import_modules<E: Engine>(name: &str) {
    let folder = std::env::temp_dir().join(format!("scriptographer-imports-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&folder);
    std::fs::create_dir_all(folder.join("lib")).unwrap();
    let write = |file: &str, code: &str| std::fs::write(folder.join(file), code).unwrap();
    // A `.pjs` module is PaperScript, with operator overloading; any other plain JavaScript.
    write(
        "shapes.pjs",
        "console.log('shapes runs')\nexport const size = 10\nexport function twice(point) { return point * 2 }\nexport default 'shapes'",
    );
    write(
        "lib/util.js",
        "import { size, twice } from '../shapes.pjs'\nexport const big = twice(new Point(size, 1))\nexport const plain = new Point(1, 2) + 1",
    );
    write("a.js", "import { b } from './b.js'\nexport const a = 1");
    write("b.js", "import { a } from './a.js'\nexport const b = 2");
    let mut runtime = Runtime::<E>::new().unwrap();
    runtime.set_script(&Setup { file: Some(folder.join("script.js").to_string_lossy().into_owned()), ..Setup::default() }).unwrap();
    let scope = runtime.create_scope(800.0, 600.0).unwrap();
    runtime
        .execute(
            &scope,
            "import shapes, { size } from './shapes.pjs'\n\
             import * as util from './lib/util.js'\n\
             console.log(shapes, size, util.big, util.plain)",
        )
        .unwrap();
    assert_eq!(runtime.take_output(), ["shapes runs", "shapes 10 { x: 20, y: 2 } { x: 1, y: 2 }1"], "shapes.pjs ran once, for both importers");
    runtime.execute(&scope, "import('./shapes.pjs').then(m => console.log('dynamic', m.default, m.size))").unwrap();
    assert_eq!(runtime.take_output(), ["dynamic shapes 10"], "the same module, already loaded");
    // `with { type }` says which, whatever the name, and a module runs once per kind:
    runtime
        .execute(
            &scope,
            "import { plain } from './lib/util.js' with { type: 'paperscript' }\n\
             import { size } from './shapes.pjs' with { type: 'javascript' }\n\
             console.log(plain, size)",
        )
        .unwrap();
    assert_eq!(runtime.take_output(), ["shapes runs", "{ x: 2, y: 3 } 10"]);
    runtime.execute(&scope, "import('./lib/util.js', { with: { type: 'paperscript' } }).then(m => console.log('dynamic', m.plain))").unwrap();
    assert_eq!(runtime.take_output(), ["dynamic { x: 2, y: 3 }"]);
    let error = runtime.execute(&scope, "import x from './shapes.pjs' with { type: 'css' }").unwrap_err();
    assert!(error.to_string().contains("'css' isn't a type of module"), "{error}");
    runtime.execute(&scope, "import('./missing.js').catch(e => console.log('rejected'))").unwrap();
    assert_eq!(runtime.take_output(), ["rejected"]);
    let error = runtime.execute(&scope, "import { a } from './a.js'").unwrap_err();
    assert!(error.to_string().contains("imports itself"), "{error}");
    let error = runtime.execute(&scope, "import x from './missing.js'").unwrap_err();
    assert!(error.to_string().contains("missing.js"), "{error}");
    std::fs::remove_dir_all(&folder).unwrap();
}

/// A local HTTP server for `count` requests: `/data.json` answers JSON, `/echo` answers the
/// request's method, content type and body. Returns its address.
fn serve(count: usize) -> String {
    use std::io::{BufRead, BufReader, Read, Write};
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let address = format!("http://{}", listener.local_addr().unwrap());
    std::thread::spawn(move || {
        for stream in listener.incoming().take(count) {
            let mut stream = stream.unwrap();
            let mut reader = BufReader::new(stream.try_clone().unwrap());
            let mut line = String::new();
            reader.read_line(&mut line).unwrap();
            let (method, path) = {
                let mut parts = line.split_whitespace();
                (parts.next().unwrap().to_owned(), parts.next().unwrap().to_owned())
            };
            let (mut length, mut kind, mut tag) = (0, String::new(), String::new());
            loop {
                let mut header = String::new();
                reader.read_line(&mut header).unwrap();
                if header.trim().is_empty() {
                    break;
                }
                let (name, value) = header.split_once(':').unwrap();
                match name.to_ascii_lowercase().as_str() {
                    "content-length" => length = value.trim().parse().unwrap(),
                    "content-type" => kind = value.trim().to_owned(),
                    "if-none-match" => tag = value.trim().to_owned(),
                    _ => {}
                }
            }
            let mut body = vec![0; length];
            reader.read_exact(&mut body).unwrap();
            let (status, content_type, answer) = match path.as_str() {
                "/data.json" => ("200 OK", "application/json", br#"{"a": 1, "list": [1, 2]}"#.to_vec()),
                "/data.xml" => ("200 OK", "application/xml", b"<a><b>1</b></a>".to_vec()),
                "/lib/mod.pjs" => ("200 OK", "text/javascript", b"import { b } from '../dep.js'\nexport const a = b + new Point(1, 1)".to_vec()),
                "/dep.js" => ("200 OK", "text/javascript", b"export const b = new Point(40, 41)".to_vec()),
                "/echo" => ("201 Created", "text/plain", [format!("{method} {kind}\n").into_bytes(), body].concat()),
                // Not modified when asked for the copy it gave, whose `ETag` the head names.
                "/kept.js" if tag == "\"one\"" => ("304 Not Modified", "text/javascript", Vec::new()),
                "/kept.js" => ("200 OK", "text/javascript", b"export const kept = 'once'".to_vec()),
                _ => ("404 Not Found", "text/plain", b"missing".to_vec()),
            };
            let head = format!(
                "HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nX-Test: one\r\nETag: \"one\"\r\nConnection: close\r\n\r\n",
                answer.len()
            );
            stream.write_all(head.as_bytes()).unwrap();
            stream.write_all(&answer).unwrap();
        }
    });
    address
}

/// Runs the runtime's timers until nothing is left, as frames would, for at most two seconds.
fn settle<E: Engine>(runtime: &mut Runtime<E>) {
    let start = std::time::Instant::now();
    while runtime.is_running() && start.elapsed() < std::time::Duration::from_secs(2) {
        std::thread::sleep(std::time::Duration::from_millis(5));
        runtime.run_timers(start.elapsed().as_secs_f64() * 1000.0).unwrap();
    }
}

/// Bodies are streams too: a response's reads as one, a stream is a body, and a request sends the
/// one it has once it's read.
fn bodies_are_streams<E: Engine>() {
    let address = serve(1);
    let mut runtime = Runtime::<E>::new().unwrap();
    let scope = runtime.create_scope(800.0, 600.0).unwrap();
    let script = format!(
        "const response = new Response('héllo')\n\
         const {{ value }} = await response.body.getReader().read()\n\
         console.log(value.length, response.bodyUsed, new Response().body, await response.text().catch(e => e.name))\n\
         const streamed = new Response(new Blob(['ab', 'cd']).stream())\n\
         const copy = streamed.clone()\n\
         console.log(await streamed.text(), await copy.text(), streamed.bodyUsed)\n\
         console.log(await new Response(ReadableStream.from(['text'])).text().catch(e => e.name))\n\
         const sent = await fetch('{address}/echo', {{ method: 'POST', body: ReadableStream.from([new Uint8Array([104, 105])]), duplex: 'half' }})\n\
         console.log(await sent.text())"
    );
    runtime.execute(&scope, &format!("(async () => {{ try {{ {script} }} catch (e) {{ console.log('error', e.name, e.message) }} }})()")).unwrap();
    settle(&mut runtime);
    assert_eq!(runtime.take_output(), ["6 true null TypeError", "abcd abcd true", "TypeError", "POST \nhi"]);
}

/// A response's body streams as it arrives: its first part reads before the server sends the
/// rest, and an abort errors what's still to come.
fn fetched_bodies_stream_as_they_arrive<E: Engine>() {
    use std::io::{BufRead, BufReader, Write};
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let address = format!("http://{}", listener.local_addr().unwrap());
    let (go, gone) = std::sync::mpsc::channel::<()>();
    std::thread::spawn(move || {
        for stream in listener.incoming().take(2) {
            let mut stream = stream.unwrap();
            let mut reader = BufReader::new(stream.try_clone().unwrap());
            let mut line = String::new();
            while reader.read_line(&mut line).unwrap() > 2 {
                line.clear();
            }
            stream.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\none").unwrap();
            stream.flush().unwrap();
            // The rest once the script read the first part, or let the request go:
            let _ = gone.recv_timeout(std::time::Duration::from_secs(5));
            let _ = stream.write_all(b"two");
        }
    });
    let mut runtime = Runtime::<E>::new().unwrap();
    runtime
        .eval(&format!(
            "const read = async reader => {{ const {{ value, done }} = await reader.read(); return done ? 'done' : new TextDecoder().decode(value) }}\n\
             ;(async () => {{\n\
               const reader = (await fetch('{address}/')).body.getReader()\n\
               console.log('part', await read(reader))\n\
               console.log('part', await read(reader), await read(reader))\n\
               const controller = new AbortController()\n\
               const aborted = (await fetch('{address}/', {{ signal: controller.signal }})).body.getReader()\n\
               console.log('part', await read(aborted))\n\
               controller.abort()\n\
               console.log(await read(aborted).catch(e => e.name))\n\
             }})()"
        ))
        .unwrap();
    let started = std::time::Instant::now();
    let mut output = Vec::new();
    while output.len() < 4 && started.elapsed() < std::time::Duration::from_secs(10) {
        runtime.run_timers(started.elapsed().as_secs_f64() * 1000.0).unwrap();
        let new = runtime.take_output();
        if new.iter().any(|line| line == "part one") {
            go.send(()).unwrap();
        }
        output.extend(new);
        std::thread::sleep(std::time::Duration::from_millis(5));
    }
    assert_eq!(output, ["part one", "part two done", "part one", "AbortError"]);
    assert!(!runtime.is_running(), "an aborted body keeps the script running no more");
}

/// An `XMLHttpRequest`'s response reports its progress as its body arrives, and `responseText` is
/// what arrived so far.
fn xml_http_requests_report_progress_as_bodies_arrive<E: Engine>() {
    use std::io::{BufRead, BufReader, Write};
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let address = format!("http://{}", listener.local_addr().unwrap());
    let (go, gone) = std::sync::mpsc::channel::<()>();
    std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        let mut reader = BufReader::new(stream.try_clone().unwrap());
        let mut line = String::new();
        while reader.read_line(&mut line).unwrap() > 2 {
            line.clear();
        }
        stream.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: 6\r\nConnection: close\r\n\r\none").unwrap();
        stream.flush().unwrap();
        let _ = gone.recv_timeout(std::time::Duration::from_secs(5));
        stream.write_all(b"two").unwrap();
    });
    let mut runtime = Runtime::<E>::new().unwrap();
    runtime
        .eval(&format!(
            "const xhr = new XMLHttpRequest()\n\
             xhr.onprogress = event => console.log('progress', event.loaded, event.total, event.lengthComputable, xhr.readyState, xhr.responseText)\n\
             xhr.onload = () => console.log('load', xhr.responseText)\n\
             xhr.open('GET', '{address}/')\n\
             xhr.send()"
        ))
        .unwrap();
    let started = std::time::Instant::now();
    let mut output = Vec::new();
    while !output.iter().any(|line: &String| line.starts_with("load")) && started.elapsed() < std::time::Duration::from_secs(10) {
        runtime.run_timers(started.elapsed().as_secs_f64() * 1000.0).unwrap();
        let new = runtime.take_output();
        if new.iter().any(|line| line.ends_with(" one")) {
            go.send(()).unwrap();
        }
        output.extend(new);
        std::thread::sleep(std::time::Duration::from_millis(60));
    }
    assert_eq!(output, ["progress 3 6 true 3 one", "progress 6 6 true 3 onetwo", "progress 6 6 true 3 onetwo", "load onetwo"]);
}

/// An `XMLHttpRequest` aborted while its body arrives ends with `abort` and nothing else, and one
/// whose connection drops halfway through its body ends with `error`, as a network error.
fn xml_http_requests_end_when_their_bodies_fail<E: Engine>() {
    use std::io::{BufRead, BufReader, Write};
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let address = format!("http://{}", listener.local_addr().unwrap());
    std::thread::spawn(move || {
        for _ in 0..2 {
            let (mut stream, _) = listener.accept().unwrap();
            let mut reader = BufReader::new(stream.try_clone().unwrap());
            let mut line = String::new();
            reader.read_line(&mut line).unwrap();
            let drops = line.contains("/drop");
            while reader.read_line(&mut line).unwrap() > 2 {
                line.clear();
            }
            stream.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 6\r\nConnection: close\r\n\r\none").unwrap();
            stream.flush().unwrap();
            std::thread::spawn(move || {
                // The dropped one closes halfway through its body; the aborted one waits.
                std::thread::sleep(std::time::Duration::from_millis(if drops { 300 } else { 5000 }));
                drop(stream);
            });
        }
    });
    let mut runtime = Runtime::<E>::new().unwrap();
    runtime
        .eval(&format!(
            "const aborted = new XMLHttpRequest()\n\
             aborted.onprogress = () => aborted.abort()\n\
             aborted.onabort = () => console.log('abort')\n\
             aborted.onloadend = () => console.log('aborted loadend')\n\
             aborted.open('GET', '{address}/abort')\n\
             aborted.send()\n\
             const dropped = new XMLHttpRequest()\n\
             dropped.onerror = () => console.log('error', dropped.readyState, dropped.status)\n\
             dropped.onloadend = () => console.log('dropped loadend')\n\
             dropped.open('GET', '{address}/drop')\n\
             dropped.send()"
        ))
        .unwrap();
    let started = std::time::Instant::now();
    let mut output = Vec::new();
    while !output.iter().any(|line: &String| line == "dropped loadend") && started.elapsed() < std::time::Duration::from_secs(10) {
        runtime.run_timers(started.elapsed().as_secs_f64() * 1000.0).unwrap();
        output.extend(runtime.take_output());
        std::thread::sleep(std::time::Duration::from_millis(20));
    }
    assert_eq!(output, ["abort", "aborted loadend", "error 4 0", "dropped loadend"]);
}

fn scripts_fetch<E: Engine>() {
    let address = serve(4);
    let mut runtime = Runtime::<E>::new().unwrap();
    let scope = runtime.create_scope(800.0, 600.0).unwrap();
    let script = format!(
        "const base = '{address}'\n\
         const response = await fetch(base + '/data.json')\n\
         const data = await response.json()\n\
         console.log(response.status, response.ok, response.headers.get('content-type'), response.headers.get('x-test'), data.a, data.list.length)\n\
         const missing = await fetch(base + '/nothing')\n\
         console.log(missing.status, missing.ok, await missing.text())\n\
         const form = new FormData()\n\
         form.append('name', 'dot')\n\
         form.append('file', new Blob(['<svg/>'], {{ type: 'image/svg+xml' }}), 'dot.svg')\n\
         const echo = await (await fetch(base + '/echo', {{ method: 'POST', body: form }})).text()\n\
         console.log(echo.startsWith('POST multipart/form-data; boundary='), echo.includes('name=\"name\"\\r\\n\\r\\ndot'), echo.includes('filename=\"dot.svg\"\\r\\nContent-Type: image/svg+xml\\r\\n\\r\\n<svg/>'))\n\
         const sent = await fetch(new Request(base + '/echo', {{ method: 'PUT', body: JSON.stringify({{ x: 1 }}), headers: {{ 'Content-Type': 'application/json' }} }}))\n\
         console.log(sent.status, await sent.text())"
    );
    runtime.execute(&scope, &format!("(async () => {{ try {{ {script} }} catch (e) {{ console.log('error', e.name, e.message) }} }})()")).unwrap();
    settle(&mut runtime);
    assert_eq!(
        runtime.take_output(),
        ["200 true application/json one 1 2", "404 false missing", "true true true", "201 PUT application/json\n{\"x\":1}"]
    );
}

fn scripts_send_xml_http_requests<E: Engine>() {
    let address = serve(4);
    // A server that takes a connection and doesn't answer before it closes, for a timeout:
    let silent = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let silent_address = format!("http://{}", silent.local_addr().unwrap());
    std::thread::spawn(move || {
        let connection = silent.accept();
        std::thread::sleep(std::time::Duration::from_millis(500));
        drop(connection);
    });
    let mut runtime = Runtime::<E>::new().unwrap();
    let scope = runtime.create_scope(800.0, 600.0).unwrap();
    let script = format!(
        "const base = '{address}'\n\
         const types = ['readystatechange', 'loadstart', 'progress', 'load', 'error', 'abort', 'timeout', 'loadend']\n\
         const request = (method, url, send) => new Promise(resolve => {{\n\
             const xhr = new XMLHttpRequest()\n\
             const events = []\n\
             for (const type of types) xhr.addEventListener(type, () => events.push(type === 'readystatechange' ? xhr.readyState : type))\n\
             xhr.upload.onload = event => events.push('upload ' + event.type)\n\
             xhr.addEventListener('loadend', () => resolve({{ xhr, events: events.join() }}))\n\
             xhr.open(method, url)\n\
             send(xhr)\n\
         }})\n\
         let {{ xhr, events }} = await request('GET', base + '/data.json', xhr => {{ xhr.responseType = 'json'; xhr.send() }})\n\
         console.log(events, xhr.status, xhr.response.list, xhr.getResponseHeader('X-Test'), xhr.responseURL === base + '/data.json')\n\
         ;({{ xhr, events }} = await request('post', base + '/echo', xhr => {{ xhr.setRequestHeader('Content-Type', 'text/plain'); xhr.send('hello') }}))\n\
         console.log(events, xhr.status, xhr.statusText, JSON.stringify(xhr.responseText))\n\
         ;({{ xhr }} = await request('GET', base + '/data.xml', xhr => xhr.send()))\n\
         console.log(xhr.responseXML.documentElement.nodeName, xhr.getAllResponseHeaders().includes('content-type: application/xml\\r\\n'))\n\
         ;({{ xhr }} = await request('GET', base + '/missing', xhr => {{ xhr.responseType = 'blob'; xhr.send() }}))\n\
         console.log(xhr.status, xhr.response.type, await xhr.response.text())\n\
         ;({{ xhr, events }} = await request('GET', 'http://127.0.0.1:1/', xhr => xhr.send()))\n\
         console.log('error', events, xhr.status)\n\
         ;({{ xhr, events }} = await request('GET', base + '/data.json', xhr => {{ xhr.send(); xhr.abort() }}))\n\
         console.log('abort', events, xhr.readyState)\n\
         ;({{ xhr, events }} = await request('GET', '{silent_address}', xhr => {{ xhr.timeout = 50; xhr.send() }}))\n\
         console.log('timeout', events)\n\
         const name = f => {{ try {{ f() }} catch (e) {{ return e.name }} }}\n\
         xhr = new XMLHttpRequest()\n\
         xhr.responseType = 'json'\n\
         console.log(name(() => xhr.open('GET', base, false)), name(() => xhr.send()), name(() => xhr.responseText), name(() => new XMLHttpRequestUpload()), String(xhr.upload))"
    );
    runtime.execute(&scope, &format!("(async () => {{ try {{ {script} }} catch (e) {{ console.log('error', e.name, e.message) }} }})()")).unwrap();
    run_until_done(&mut runtime);
    assert_eq!(
        runtime.take_output(),
        [
            "1,loadstart,2,3,progress,progress,4,load,loadend 200 [1, 2] one true",
            "1,loadstart,upload load,2,3,progress,progress,4,load,loadend 201 Created \"POST text/plain\\nhello\"",
            "a true",
            "404 text/plain missing",
            "error 1,loadstart,4,error,loadend 0",
            "abort 1,loadstart,4,abort,loadend 0",
            "timeout 1,loadstart,4,timeout,loadend",
            "InvalidAccessError InvalidStateError InvalidStateError TypeError [object XMLHttpRequestUpload]",
        ]
    );
}

fn scripts_import_from_the_web<E: Engine>() {
    let address = serve(2);
    let mut runtime = Runtime::<E>::new().unwrap();
    let scope = runtime.create_scope(800.0, 600.0).unwrap();
    runtime.execute(&scope, &format!("import {{ a }} from '{address}/lib/mod.pjs'\nconsole.log(a)")).unwrap();
    assert_eq!(runtime.take_output(), [format!("import {address}/lib/mod.pjs"), format!("import {address}/dep.js"), "{ x: 41, y: 42 }".to_owned()]);
}

fn scripts_have_urls<E: Engine>() {
    let mut runtime = Runtime::<E>::new().unwrap();
    let scope = runtime.create_scope(800.0, 600.0).unwrap();
    runtime
        .execute(
            &scope,
            "const url = new URL('../b/c?x=1&y=two#top', 'https://user:pw@example.com:8080/a/index.html')\n\
             console.log(url.href, url.origin, url.host, url.pathname, url.search, url.hash, url.username)\n\
             url.searchParams.append('z', 'a b')\n\
             url.hash = ''\n\
             console.log(url.toString(), url.searchParams.get('y'), url.searchParams.size)\n\
             url.search = '?q=1'\n\
             console.log(url.searchParams.get('q'), url.searchParams.has('x'), JSON.stringify({ url }))\n\
             const params = new URLSearchParams({ b: 2, a: 1 })\n\
             params.sort()\n\
             console.log(String(params), [...new URLSearchParams('?k=v&k=w').getAll('k')], URL.canParse('nope'), URL.canParse('/x', 'http://h'))\n\
             try { new URL('nope') } catch (e) { console.log('invalid') }",
        )
        .unwrap();
    assert_eq!(
        runtime.take_output(),
        [
            "https://user:pw@example.com:8080/b/c?x=1&y=two#top https://example.com:8080 example.com:8080 /b/c ?x=1&y=two #top user",
            "https://user:pw@example.com:8080/b/c?x=1&y=two&z=a+b two 3",
            "1 false {\"url\":\"https://user:pw@example.com:8080/b/c?q=1\"}",
            "a=1&b=2 ['v', 'w'] false true",
            "invalid"
        ]
    );
}

fn scripts_measure_text<E: Engine>() {
    let mut runtime = Runtime::<E>::new().unwrap();
    let scope = runtime.create_scope(800.0, 600.0).unwrap();
    runtime
        .execute(
            &scope,
            "const ctx = new OffscreenCanvas(1, 1).getContext('2d')\n\
             console.log(ctx.font)\n\
             ctx.font = '20px \"Source Sans 3\"'\n\
             const small = ctx.measureText('Hello')\n\
             ctx.font = 'bold 40px \"Source Sans 3\"'\n\
             const big = ctx.measureText('Hello')\n\
             console.log(small.width > 30, big.width > 2 * small.width, small.fontBoundingBoxAscent > small.actualBoundingBoxAscent, small.actualBoundingBoxAscent > 10)\n\
             console.log(ctx.measureText('Hello ').width > ctx.measureText('Hello').width, ctx.measureText('').width)\n\
             const text = new PointText({ point: [0, 0], content: 'Hello', fontFamily: 'Source Sans 3', fontSize: 20 })\n\
             console.log(Math.abs(text.bounds.width - small.width) < 0.01)",
        )
        .unwrap();
    assert_eq!(runtime.take_output(), ["10px sans-serif", "true true true true", "true 0", "true"], "bold is wider than twice the size alone");
}

/// `letterSpacing` after each character and `wordSpacing` at each space widen text as it's
/// measured and drawn, and the font reads back as browsers write it.
fn text_takes_letter_and_word_spacing<E: Engine>() {
    let mut runtime = Runtime::<E>::new().unwrap();
    let scope = runtime.create_scope(800.0, 600.0).unwrap();
    runtime
        .execute(
            &scope,
            "const ctx = new OffscreenCanvas(1, 1).getContext('2d')\n\
             ctx.font = '20PX   SERIF'\n\
             const width = ctx.measureText('Hello World').width\n\
             ctx.letterSpacing = '3px'\n\
             const letters = ctx.measureText('Hello World').width - width\n\
             ctx.letterSpacing = '0px'\n\
             ctx.wordSpacing = '0.5em'\n\
             const words = ctx.measureText('Hello World').width - width\n\
             console.log(ctx.font, letters.toFixed(3), words.toFixed(3), ctx.wordSpacing)",
        )
        .unwrap();
    assert_eq!(runtime.take_output(), ["20px serif 33.000 10.000 0.5em"], "11 characters, 1 space, an em of 20px");
}

/// `roundRect()`'s radii as the standard reads them: elliptical ones too, and the errors.
fn round_rects_take_elliptical_radii<E: Engine>() {
    let mut runtime = Runtime::<E>::new().unwrap();
    let scope = runtime.create_scope(800.0, 600.0).unwrap();
    runtime
        .execute(
            &scope,
            "const thrown = f => { try { return f() } catch (e) { return e.name } }\n\
             const ctx = new OffscreenCanvas(40, 20).getContext('2d')\n\
             ctx.roundRect(0, 0, 40, 20, new DOMPoint(20, 10))\n\
             ctx.fill()\n\
             const alpha = (x, y) => ctx.getImageData(x, y, 1, 1).data[3]\n\
             console.log(alpha(2, 2), alpha(20, 10), alpha(20, 1), alpha(1, 10))\n\
             console.log(thrown(() => ctx.roundRect(0, 0, 1, 1, [])), thrown(() => ctx.roundRect(0, 0, 1, 1, [-1])), thrown(() => ctx.roundRect(0, 0, 1, 1, 0n)), ctx.roundRect(0, 0, 1, 1, [NaN]))",
        )
        .unwrap();
    assert_eq!(
        runtime.take_output(),
        ["0 255 255 255", "RangeError RangeError TypeError undefined"],
        "an ellipse fills the rectangle, its corners empty"
    );
}

/// Matrices read CSS's transform functions, as a window's do.
fn matrices_read_css<E: Engine>() {
    let mut runtime = Runtime::<E>::new().unwrap();
    let scope = runtime.create_scope(800.0, 600.0).unwrap();
    runtime
        .execute(
            &scope,
            "const thrown = f => { try { return f() } catch (e) { return e.name } }\n\
             const m = new DOMMatrix('scale(2) translateX(calc(2 * 2.5px)) translateY(5px) rotate(0.25turn) rotate(-90deg)')\n\
             console.log(m.a, m.d, m.e, m.f, m.is2D, new DOMMatrix('').isIdentity, new DOMMatrix(' NONE /**/ ').isIdentity)\n\
             console.log(new DOMMatrix('translateZ(0)').is2D, String(new DOMMatrix(m)) === String(m), new DOMMatrix().setMatrixValue('skewX(45deg)').c.toFixed(3))\n\
             console.log(['translateX(5em)', 'rotate(5)', 'scale(2 2)', 'scale(2), translateX(1px)', ' ', 'inherit', null].map(text => thrown(() => new DOMMatrix(text))).join())",
        )
        .unwrap();
    assert_eq!(
        runtime.take_output(),
        ["2 2 10 10 true true true", "false true 1.000", "SyntaxError,SyntaxError,SyntaxError,SyntaxError,SyntaxError,SyntaxError,SyntaxError"]
    );
}

/// The canvas and its context as WebIDL has them: one 2D context, known names, sizes converted,
/// required arguments.
fn canvas_contexts_are_the_browsers<E: Engine>() {
    let mut runtime = Runtime::<E>::new().unwrap();
    let scope = runtime.create_scope(800.0, 600.0).unwrap();
    runtime
        .execute(
            &scope,
            "const thrown = f => { try { return f() } catch (e) { return e.name } }\n\
             const canvas = new OffscreenCanvas(10, 10)\n\
             const ctx = canvas.getContext('2d')\n\
             console.log(ctx instanceof OffscreenCanvasRenderingContext2D, ctx.canvas === canvas, canvas.getContext('2d') === ctx, canvas.getContext('webgl'))\n\
             console.log(thrown(() => canvas.getContext('2D')), thrown(() => canvas.getContext()), thrown(() => new OffscreenCanvasRenderingContext2D()))\n\
             canvas.width = '0x96'\n\
             canvas.height = 2147483647\n\
             console.log(canvas.width, canvas.height, thrown(() => { canvas.width = -1 }), thrown(() => new OffscreenCanvas(1)))\n\
             console.log(thrown(() => ctx.scale(1)), thrown(() => ctx.drawImage(canvas, 0)), thrown(() => ctx.setTransform(1)), ctx.setTransform())",
        )
        .unwrap();
    assert_eq!(
        runtime.take_output(),
        ["true true true null", "TypeError TypeError TypeError", "150 2147483647 TypeError TypeError", "TypeError TypeError TypeError undefined"]
    );
}

fn canvases_have_pixels<E: Engine>() {
    let mut runtime = Runtime::<E>::new().unwrap();
    let scope = runtime.create_scope(800.0, 600.0).unwrap();
    runtime
        .execute(
            &scope,
            "const canvas = new OffscreenCanvas(4, 3)\n\
             const ctx = canvas.getContext('2d')\n\
             ctx.fillStyle = 'rgba(255, 0, 0, 0.5)'\n\
             ctx.fillRect(1, 1, 2, 5)\n\
             const data = ctx.getImageData(0, 0, 4, 3).data\n\
             console.log(data.length, [...data.slice(0, 4)], [...data.slice(20, 24)], data instanceof Uint8ClampedArray)\n\
             const image = new ImageData(new Uint8ClampedArray([0, 255, 0, 255]), 1)\n\
             ctx.putImageData(image, 3, 0)\n\
             ctx.clearRect(1, 1, 1, 1)\n\
             console.log([...ctx.getImageData(3, 0, 1, 1).data], [...ctx.getImageData(1, 1, 1, 1).data], [...ctx.getImageData(-1, -1, 1, 1).data])\n\
             canvas.width = 2\n\
             console.log(canvas.width, canvas.height, [...ctx.getImageData(1, 1, 1, 1).data])\n\
             const raster = new Raster(new Size(3, 2))\n\
             raster.setPixel(1, 1, new Color(0, 0, 1))\n\
             console.log(raster.getPixel(1, 1).toCSS(true), raster.getPixel(0, 0).alpha)\n\
             console.log(Object.keys(canvas).length, Object.keys(new Path2D()).length, ctx.fillStyle)\n\
             canvas.convertToBlob().then(blob => blob.bytes()).then(png => console.log(png[1], png[2], png[3]))",
        )
        .unwrap();
    assert_eq!(
        runtime.take_output(),
        [
            "48 [0, 0, 0, 0] [255, 0, 0, 128] true",
            "[0, 255, 0, 255] [0, 0, 0, 0] [0, 0, 0, 0]",
            "2 3 [0, 0, 0, 0]",
            "#0000ff 0",
            "0 0 #000000",
            "80 78 71"
        ],
        "a half red stays half red, cleared and outside is transparent, resizing clears, PNG's signature"
    );
}

fn canvases_draw<E: Engine>() {
    let mut runtime = Runtime::<E>::new().unwrap();
    let scope = runtime.create_scope(800.0, 600.0).unwrap();
    runtime
        .execute(
            &scope,
            "const canvas = new OffscreenCanvas(40, 40)\n\
             const ctx = canvas.getContext('2d')\n\
             const at = (x, y) => [...ctx.getImageData(x, y, 1, 1).data].join()\n\
             ctx.save()\n\
             ctx.translate(10, 10)\n\
             ctx.scale(2, 2)\n\
             ctx.fillStyle = 'red'\n\
             ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(5, 0); ctx.lineTo(5, 5); ctx.lineTo(0, 5); ctx.closePath(); ctx.fill()\n\
             ctx.lineWidth = 2\n\
             ctx.strokeStyle = 'blue'\n\
             ctx.beginPath(); ctx.moveTo(0, 10); ctx.lineTo(10, 10); ctx.stroke()\n\
             ctx.restore()\n\
             console.log(at(15, 15), at(25, 25), at(15, 29), at(15, 32), ctx.fillStyle, ctx.getTransform().a)\n\
             ctx.clearRect(0, 0, 40, 40)\n\
             ctx.beginPath(); ctx.arc(20, 20, 10, 0, Math.PI * 2); ctx.fillStyle = '#00ff00'; ctx.fill()\n\
             console.log(at(20, 20), at(2, 2), ctx.isPointInPath(20, 20), ctx.isPointInPath(1, 1))\n\
             ctx.save(); ctx.beginPath(); ctx.rect(0, 0, 20, 40); ctx.clip()\n\
             ctx.fillStyle = 'blue'; ctx.fillRect(0, 0, 40, 40); ctx.restore()\n\
             console.log(at(5, 5), at(35, 5))\n\
             const gradient = ctx.createLinearGradient(0, 0, 40, 0)\n\
             gradient.addColorStop(0, 'red'); gradient.addColorStop(1, 'blue')\n\
             ctx.fillStyle = gradient; ctx.fillRect(0, 0, 40, 40)\n\
             const [left, right] = [ctx.getImageData(1, 1, 1, 1).data, ctx.getImageData(38, 1, 1, 1).data]\n\
             console.log(left[0] > 200 && left[2] < 50, right[2] > 200 && right[0] < 50, ctx.fillStyle === gradient)\n\
             const small = new OffscreenCanvas(2, 2)\n\
             small.getContext('2d').fillRect(0, 0, 1, 1)\n\
             ctx.imageSmoothingEnabled = false\n\
             ctx.drawImage(small, 0, 0, 20, 20)\n\
             console.log(at(5, 5), at(15, 15) === at(15, 5))\n\
             ctx.globalCompositeOperation = 'destination-out'\n\
             ctx.fillRect(0, 0, 10, 10)\n\
             ctx.globalCompositeOperation = 'source-over'\n\
             console.log(at(5, 5).endsWith(',0'))\n\
             ctx.clearRect(0, 0, 40, 40)\n\
             ctx.font = '30px \"Source Sans 3\"'; ctx.fillStyle = 'black'; ctx.fillText('H', 5, 35)\n\
             const ink = ctx.getImageData(0, 0, 40, 40).data.filter((v, i) => i % 4 === 3 && v > 128).length\n\
             console.log(ink > 50)\n\
             const raster = new Path.Circle({ center: [10, 10], radius: 10, fillColor: 'red', insert: false }).rasterize({ resolution: 72, insert: false })\n\
             console.log(raster.width, raster.getPixel(10, 10).toCSS(true), raster.getPixel(0, 0).alpha)",
        )
        .unwrap();
    assert_eq!(
        runtime.take_output(),
        [
            "255,0,0,255 0,0,0,0 0,0,255,255 0,0,0,0 #000000 1",
            "0,255,0,255 0,0,0,0 true false",
            "0,0,255,255 0,0,0,0",
            "true true true",
            "0,0,0,255 true",
            "true",
            "true",
            "20 #ff0000 0"
        ]
    );
}

fn fetch_classes_work_alone<E: Engine>() {
    let mut runtime = Runtime::<E>::new().unwrap();
    let scope = runtime.create_scope(800.0, 600.0).unwrap();
    runtime
        .execute(
            &scope,
            "const headers = new Headers({ 'Content-Type': 'text/plain', 'X-B': '1' })\n\
             headers.append('x-b', '2')\n\
             console.log([...headers].map(([n, v]) => n + '=' + v).join(' '), headers.has('content-type'))\n\
             const blob = new Blob(['ab', new Uint8Array([99]), new Blob(['d'])], { type: 'Text/Plain' })\n\
             blob.slice(1, -1).text().then(t => console.log(blob.size, blob.type, t))\n\
             const form = new FormData()\n\
             form.append('a', 1)\n\
             form.set('a', 2)\n\
             console.log([...form.entries()].join(), form.has('a'))\n\
             new Response('hi', { status: 202 }).text().then(t => console.log('response', t))\n\
             const controller = new AbortController()\n\
             controller.signal.addEventListener('abort', () => console.log('aborted', controller.signal.reason.name))\n\
             fetch('http://127.0.0.1:1/', { signal: controller.signal }).catch(e => console.log('rejected', e.name))\n\
             controller.abort()",
        )
        .unwrap();
    settle(&mut runtime);
    assert_eq!(
        runtime.take_output(),
        ["content-type=text/plain x-b=1, 2 true", "a,2 true", "aborted AbortError", "4 text/plain bc", "response hi", "rejected AbortError"]
    );
}

fn css_colors_resolve_without_a_canvas<E: Engine>() {
    let mut runtime = Runtime::<E>::new().unwrap();
    let scope = runtime.create_scope(800.0, 600.0).unwrap();
    runtime
        .execute(
            &scope,
            "['cornflowerblue', '#f80', 'rgb(0, 128, 255)', 'hsl(120, 100%, 50%)', 'nocolor'].forEach(function(css) {\n\
                 console.log(new Color(css).toCSS(true))\n\
             })",
        )
        .unwrap();
    // cornflowerblue is rgb(100, 149, 237) in CSS; an unknown name is black, as in browsers.
    assert_eq!(runtime.take_output(), ["#6495ed", "#ff8800", "#0080ff", "#00ff00", "#000000"]);
}

fn canvases_draw_shadows_and_filters<E: Engine>() {
    let mut runtime = Runtime::<E>::new().unwrap();
    let scope = runtime.create_scope(800.0, 600.0).unwrap();
    runtime
        .execute(
            &scope,
            "const canvas = new OffscreenCanvas(40, 40)\n\
             const ctx = canvas.getContext('2d')\n\
             const at = (x, y) => [...ctx.getImageData(x, y, 1, 1).data].join()\n\
             const alpha = (x, y) => ctx.getImageData(x, y, 1, 1).data[3]\n\
             ctx.save()\n\
             ctx.scale(2, 2)\n\
             ctx.shadowColor = 'blue'; ctx.shadowOffsetX = 15; ctx.shadowColor = 'nope'\n\
             ctx.fillStyle = 'red'; ctx.fillRect(2.5, 2.5, 5, 5)\n\
             console.log(at(10, 10), at(20, 10), at(30, 10), ctx.shadowColor)\n\
             ctx.restore()\n\
             console.log(ctx.shadowColor, ctx.shadowOffsetX)\n\
             ctx.clearRect(0, 0, 40, 40)\n\
             ctx.shadowColor = 'black'; ctx.shadowBlur = 8; ctx.fillRect(15, 15, 10, 10)\n\
             console.log(alpha(20, 20), alpha(13, 20) > 0 && alpha(13, 20) < 255, alpha(0, 0))\n\
             ctx.shadowColor = 'transparent'\n\
             ctx.clearRect(0, 0, 40, 40)\n\
             ctx.filter = 'blur(2px)'; ctx.filter = 'bogus(1px)'; ctx.fillRect(10, 10, 20, 20)\n\
             console.log(ctx.filter, alpha(20, 20), alpha(10, 20) > 0 && alpha(10, 20) < 255, alpha(7, 20) > 0)\n\
             ctx.clearRect(0, 0, 40, 40)\n\
             ctx.filter = 'drop-shadow(10px 0 lime) brightness(50%)'; ctx.fillStyle = 'red'; ctx.fillRect(0, 0, 10, 10)\n\
             console.log(at(5, 5), at(15, 5), at(25, 5))\n\
             ctx.filter = 'none'\n\
             ctx.clearRect(0, 0, 40, 40)\n\
             // A clip right after a stroke under a transform is in pixels too.\n\
             ctx.save(); ctx.scale(4, 4); ctx.beginPath(); ctx.moveTo(0, 9); ctx.lineTo(1, 9); ctx.stroke(); ctx.restore()\n\
             ctx.save(); ctx.beginPath(); ctx.rect(0, 0, 20, 30); ctx.clip(); ctx.fillStyle = 'blue'; ctx.fillRect(0, 0, 40, 30); ctx.restore()\n\
             console.log(at(5, 5), at(35, 5))",
        )
        .unwrap();
    assert_eq!(
        runtime.take_output(),
        [
            "255,0,0,255 0,0,255,255 0,0,0,0 #0000ff",
            "rgba(0, 0, 0, 0) 0",
            "255 true 0",
            "blur(2px) 255 true true",
            "255,0,0,255 0,255,0,255 0,0,0,0",
            "0,0,255,255 0,0,0,0",
        ]
    );
}

fn canvases_draw_path2d<E: Engine>() {
    let mut runtime = Runtime::<E>::new().unwrap();
    let scope = runtime.create_scope(800.0, 600.0).unwrap();
    runtime
        .execute(
            &scope,
            "const canvas = new OffscreenCanvas(40, 40)\n\
             const ctx = canvas.getContext('2d')\n\
             const at = (x, y) => [...ctx.getImageData(x, y, 1, 1).data].join()\n\
             const square = new Path2D(); square.rect(0, 0, 10, 10)\n\
             ctx.translate(20, 20); ctx.fillStyle = 'red'; ctx.fill(square)\n\
             console.log(at(25, 25), at(5, 5), ctx.isPointInPath(square, 25, 25), ctx.isPointInPath(square, 5, 5))\n\
             ctx.resetTransform(); ctx.clearRect(0, 0, 40, 40)\n\
             const svg = new Path2D('M0 0 H20 V20 H0 Z m30 0 h10 v10 h-10 z L oops')\n\
             ctx.fill(svg)\n\
             console.log(at(10, 10), at(35, 5), at(25, 5))\n\
             const both = new Path2D(square); both.addPath(square, { e: 30, f: 30 })\n\
             ctx.clearRect(0, 0, 40, 40); ctx.fill(both)\n\
             console.log(at(5, 5), at(35, 35), at(20, 20))\n\
             ctx.clearRect(0, 0, 40, 40); ctx.save(); ctx.clip(square); ctx.fillRect(0, 0, 40, 40); ctx.restore()\n\
             console.log(at(5, 5), at(15, 15))\n\
             const line = new Path2D(); line.moveTo(0, 20); line.lineTo(40, 20)\n\
             ctx.lineWidth = 4\n\
             console.log(ctx.isPointInStroke(line, 20, 21), ctx.isPointInStroke(line, 20, 23))\n\
             ctx.scale(2, 2)\n\
             console.log(ctx.isPointInStroke(line, 20, 43), ctx.isPointInStroke(line, 20, 45))\n\
             ctx.beginPath(); ctx.moveTo(0, 5); ctx.lineTo(10, 5)\n\
             console.log(ctx.isPointInStroke(5, 10), ctx.isPointInStroke(5, 20))\n\
             ctx.resetTransform(); ctx.scale(Number.MAX_VALUE, Number.MAX_VALUE); ctx.beginPath(); ctx.rect(-10, -10, 20, 20)\n\
             const huge = ctx.isPointInPath(0, 0)\n\
             ctx.resetTransform(); ctx.scale(0, 0); ctx.beginPath(); ctx.rect(-10, -10, 20, 20)\n\
             console.log(huge, ctx.isPointInPath(0, 0))",
        )
        .unwrap();
    assert_eq!(
        runtime.take_output(),
        [
            "255,0,0,255 0,0,0,0 true false",
            // The data's valid start draws; the rest is dropped.
            "255,0,0,255 255,0,0,255 0,0,0,0",
            "255,0,0,255 255,0,0,255 0,0,0,0",
            "255,0,0,255 0,0,0,0",
            // The line is in user space, its width scaled with it.
            "true false",
            "true false",
            "true false",
            // A path scaled to infinity has an inside; a flattening transform leaves none.
            "true false",
        ]
    );
}

fn canvas_colors_are_css_colors<E: Engine>() {
    let mut runtime = Runtime::<E>::new().unwrap();
    let scope = runtime.create_scope(800.0, 600.0).unwrap();
    runtime
        .execute(
            &scope,
            "const ctx = new OffscreenCanvas(1, 1).getContext('2d')\n\
             const read = css => { ctx.fillStyle = '#123456'; ctx.fillStyle = css; return ctx.fillStyle }\n\
             console.log(read('rgb(255 0 0 / 50%)'), read('hsl( 120 , 100% , 50% )'), read('grey'), read('oklch(0.628 0.258 29.2)'))\n\
             console.log(read('rgba(255,255,255,0.5)'), read('rgb(255, 0 0)'), read('nope'))\n\
             console.log(new Color('grey').toCSS(true))",
        )
        .unwrap();
    assert_eq!(
        runtime.take_output(),
        [
            // A colour in a syntax other than the legacy one comes back in it, as in browsers.
            "rgba(255, 0, 0, 0.5) #00ff00 #808080 oklch(0.628 0.258 29.2)",
            // Alpha as few decimals as give the same 8 bits back; invalid colours change nothing.
            "rgba(255, 255, 255, 0.5) #123456 #123456",
            "#808080",
        ]
    );
}

fn image_bitmaps_decode_crop_flip_and_resize<E: Engine>() {
    let mut runtime = Runtime::<E>::new().unwrap();
    let scope = runtime.create_scope(800.0, 600.0).unwrap();
    runtime
        .execute(
            &scope,
            "const source = new OffscreenCanvas(4, 2)\n\
             const ctx = source.getContext('2d')\n\
             ctx.fillStyle = 'red'; ctx.fillRect(0, 0, 2, 2); ctx.fillStyle = 'blue'; ctx.fillRect(2, 0, 2, 2)\n\
             const tall = new OffscreenCanvas(1, 2)\n\
             const tctx = tall.getContext('2d')\n\
             tctx.fillStyle = 'red'; tctx.fillRect(0, 0, 1, 1); tctx.fillStyle = 'blue'; tctx.fillRect(0, 1, 1, 1)\n\
             const at = (image, x, y) => {\n\
                 const canvas = new OffscreenCanvas(image.width, image.height)\n\
                 const c = canvas.getContext('2d')\n\
                 c.drawImage(image, 0, 0)\n\
                 return [...c.getImageData(x, y, 1, 1).data].join()\n\
             }\n\
             ;(async () => {\n\
                 const decoded = await createImageBitmap(await source.convertToBlob())\n\
                 console.log(decoded instanceof ImageBitmap, decoded.width, decoded.height, at(decoded, 0, 0), at(decoded, 3, 1))\n\
                 const cropped = await createImageBitmap(source, 2, 0, 2, 2)\n\
                 console.log(cropped.width, at(cropped, 0, 0))\n\
                 console.log(at(await createImageBitmap(tall, { imageOrientation: 'flipY' }), 0, 0))\n\
                 const big = await createImageBitmap(source, { resizeWidth: 8, resizeQuality: 'pixelated' })\n\
                 console.log(big.width, big.height, at(big, 3, 3), at(big, 4, 0))\n\
                 console.log(at(await createImageBitmap(new ImageData(new Uint8ClampedArray([0, 255, 0, 255]), 1, 1)), 0, 0))\n\
                 decoded.close()\n\
                 try { new OffscreenCanvas(1, 1).getContext('2d').drawImage(decoded, 0, 0) } catch (e) { console.log(decoded.width, e instanceof DOMException, e.name, e.message) }\n\
                 try { await createImageBitmap(new Blob(['no image'])) } catch (e) { console.log(e.name) }\n\
             })()",
        )
        .unwrap();
    assert_eq!(
        runtime.take_output(),
        [
            "true 4 2 255,0,0,255 0,0,255,255",
            "2 0,0,255,255",
            "0,0,255,255",
            "8 4 255,0,0,255 0,0,255,255",
            "0,255,0,255",
            "0 true InvalidStateError the image bitmap is closed",
            "InvalidStateError",
        ]
    );
}

fn host_functions_throw_the_browsers_exceptions<E: Engine>() {
    let mut runtime = Runtime::<E>::new().unwrap();
    let scope = runtime.create_scope(800.0, 600.0).unwrap();
    runtime
        .execute(
            &scope,
            "const ctx = new OffscreenCanvas(1, 1).getContext('2d')\n\
             const thrown = f => { try { f() } catch (e) { return e } }\n\
             const range = thrown(() => ctx.arc(0, 0, -1, 0, 1))\n\
             console.log(range instanceof DOMException, range instanceof Error, range.name, range.code, range.code === DOMException.INDEX_SIZE_ERR)\n\
             console.log(String(range), Object.prototype.toString.call(range) !== '')\n\
             console.log(thrown(() => new Path2D().addPath(1)) instanceof TypeError, thrown(() => ctx.roundRect(0, 0, 1, 1, -1)) instanceof RangeError)\n\
             const own = new DOMException('gone', 'NotFoundError')\n\
             console.log(own.name, own.message, own.code, new DOMException().name)\n\
             const controller = new AbortController(); controller.abort()\n\
             console.log(controller.signal.reason instanceof DOMException, controller.signal.reason.name)",
        )
        .unwrap();
    assert_eq!(
        runtime.take_output(),
        [
            "true true IndexSizeError 1 true",
            "IndexSizeError: arc: the radius is negative true",
            "true true",
            "NotFoundError gone 8 Error",
            "true AbortError",
        ]
    );
}

fn canvas_properties_ignore_what_they_dont_take<E: Engine>() {
    let mut runtime = Runtime::<E>::new().unwrap();
    let scope = runtime.create_scope(800.0, 600.0).unwrap();
    runtime
        .execute(
            &scope,
            "const canvas = new OffscreenCanvas(2, 2)\n\
             const ctx = canvas.getContext('2d')\n\
             ctx.lineWidth = 0; ctx.lineWidth = -1; ctx.lineWidth = Infinity; ctx.lineCap = 'flat'; ctx.globalAlpha = 2\n\
             ctx.globalCompositeOperation = 'Xor'; ctx.textAlign = 'middle'; ctx.letterSpacing = '3 px'; ctx.font = 'big'\n\
             console.log(ctx.lineWidth, ctx.lineCap, ctx.globalAlpha, ctx.globalCompositeOperation, ctx.textAlign, ctx.letterSpacing, ctx.font)\n\
             ctx.lineWidth = '1e1'; ctx.lineCap = 'round'; ctx.wordSpacing = '2em'; ctx.imageSmoothingEnabled = 0; ctx.fontKerning = 'none'\n\
             console.log(ctx.lineWidth, ctx.lineCap, ctx.wordSpacing, ctx.imageSmoothingEnabled, ctx.fontKerning)\n\
             ctx.save(); ctx.lineWidth = 3; ctx.restore()\n\
             console.log(ctx.lineWidth)\n\
             canvas.width = 2\n\
             console.log(ctx.lineWidth, ctx.lineCap, ctx.wordSpacing, ctx.fontKerning)",
        )
        .unwrap();
    assert_eq!(
        runtime.take_output(),
        [
            "1 butt 1 source-over start 0px 10px sans-serif",
            "10 round 2em false none",
            "10",
            // Setting the size resets the context, as in browsers.
            "1 butt 0px auto",
        ]
    );
}

fn geometry_classes_are_the_browsers<E: Engine>() {
    let mut runtime = Runtime::<E>::new().unwrap();
    let scope = runtime.create_scope(800.0, 600.0).unwrap();
    runtime
        .execute(
            &scope,
            "const m = new DOMMatrix().translate(10, 20).scale(2)\n\
             console.log(String(m), m.a, m.m41, m.is2D, m.isIdentity, Object.prototype.toString.call(m))\n\
             const p = m.transformPoint(new DOMPoint(1, 1))\n\
             console.log(p instanceof DOMPoint, p.x, p.y, String(m.inverse().multiply(m)), m instanceof DOMMatrixReadOnly)\n\
             const r = new DOMMatrix([1, 0, 0, 1, 0, 0]).rotate(90)\n\
             console.log(Math.round(r.b), Math.round(r.c), new DOMMatrix().rotate(0, 30, 0).is2D)\n\
             m.m13 = 1\n\
             console.log(m.is2D, String(DOMMatrix.fromMatrix({ a: 2, m22: 3 })))\n\
             const thrown = f => { try { f() } catch (e) { return e.name } }\n\
             console.log(thrown(() => DOMMatrix.fromMatrix({ a: 1, m11: 2 })), thrown(() => new DOMMatrix('matrix(1, 0, 0)')), thrown(() => String(new DOMMatrix([NaN, 0, 0, 1, 0, 0]))))\n\
             const rect = new DOMRect(10, 10, -5, 20)\n\
             console.log(rect.left, rect.right, rect.top, rect.bottom, JSON.stringify(new DOMQuad({ x: 1, y: 2 }, { x: 5 }).getBounds()))\n\
             const ctx = new OffscreenCanvas(1, 1).getContext('2d')\n\
             ctx.setTransform(new DOMMatrix().translate(3, 4))\n\
             console.log(ctx.getTransform() instanceof DOMMatrix, ctx.getTransform().e, ctx.getTransform().f, WebKitCSSMatrix === DOMMatrix)",
        )
        .unwrap();
    assert_eq!(
        runtime.take_output(),
        [
            "matrix(2, 0, 0, 2, 10, 20) 2 10 true false [object DOMMatrix]",
            "true 12 22 matrix(1, 0, 0, 1, 0, 0) true",
            "1 -1 false",
            "false matrix(2, 0, 0, 3, 0, 0)",
            // `a` and `m11` disagree; no CSS outside a window; a matrix that isn't finite has no string.
            "TypeError SyntaxError InvalidStateError",
            "5 10 10 30 {\"x\":0,\"y\":0,\"width\":5,\"height\":2,\"top\":0,\"right\":5,\"bottom\":2,\"left\":0}",
            "true 3 4 true",
        ]
    );
}

fn local_storage_and_preferences_last_and_session_storage_doesnt<E: Engine>(name: &str) {
    let folder = std::env::temp_dir().join(format!("scriptographer-storage-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&folder);
    let (script, storage) = (folder.join("script.js").to_string_lossy().into_owned(), folder.join("storage"));
    let run = |source: &str| {
        let mut runtime = Runtime::<E>::new().unwrap();
        runtime.set_script(&Setup { file: Some(script.clone()), storage: Some(storage.clone()), ..Setup::default() }).unwrap();
        let scope = runtime.create_scope(800.0, 600.0).unwrap();
        runtime.execute(&scope, source).unwrap();
        runtime.keep_preferences().unwrap();
        runtime.take_output()
    };
    let first = run("localStorage.setItem('a', 1); localStorage.b = { toString: () => 'two' }; sessionStorage.c = 'gone'\n\
         console.log(localStorage.length, localStorage.getItem('a'), localStorage.b, localStorage.key(1), localStorage.getItem('x'), localStorage.x)\n\
         console.log(Object.keys(localStorage).join(), 'b' in localStorage, localStorage instanceof Storage, typeof localStorage.getItem)\n\
         localStorage.getItem = 'item'; delete localStorage.a\n\
         console.log(localStorage.getItem('getItem'), localStorage.length)\n\
         const thrown = f => { try { f() } catch (e) { return e.name } }\n\
         console.log(thrown(() => localStorage.setItem('big', 'x'.repeat(6 * 1024 * 1024))))\n\
         script.preferences.point = new Point(1, 2)");
    assert_eq!(
        first,
        [
            "2 1 two b null undefined",
            "a,b true true function",
            // Properties the storage has are its own; others are items.
            "item 2",
            "QuotaExceededError",
        ]
    );
    // The next run of the script has its local items, not its session ones, and its preferences.
    let second = run(
        "console.log(localStorage.length, localStorage.b, localStorage.getItem('getItem'), sessionStorage.length, script.preferences.point instanceof Point)\n\
         localStorage.clear()",
    );
    assert_eq!(second, ["2 two item 0 true"]);
    let third = run("console.log(localStorage.length, script.preferences.point.y)");
    assert_eq!(third, ["0 2"], "clear() leaves the preferences");
    std::fs::remove_dir_all(&folder).unwrap();
}

fn the_console_writes_as_browsers_do<E: Engine>() {
    let mut runtime = Runtime::<E>::new().unwrap();
    let scope = runtime.create_scope(800.0, 600.0).unwrap();
    runtime
        .execute(
            &scope,
            "class Swatch { constructor() { this.name = 'red' } }\n\
             function make() {}\n\
             console.log([1, 'two', [3, { four: 4 }]], { a: 1, b: 'b' }, new Swatch(), make, null, new Point(1, 2))\n\
             console.log('%s is %d years and %f%%, %o', 'Paper.js', 15.7, 0.5, { x: 1 }, 'more')\n\
             console.assert(1 === 1, 'not shown'); console.assert(false, 'shown', 2)\n\
             console.count(); console.count(); console.count('other'); console.countReset(); console.count()\n\
             console.group('outer'); console.info('in'); console.group(); console.warn('deeper'); console.groupEnd(); console.groupEnd(); console.error('out')\n\
             console.time('t'); console.time('t'); console.timeEnd('t'); console.timeEnd('t')\n\
             console.table([{ a: 1, b: 2 }, { a: 3 }])\n\
             print('printed')\n\
             function deep() { console.trace('here') }\n\
             deep()",
        )
        .unwrap();
    let mut output = runtime.take_output();
    // The trace ends the output: the line, then where it came from.
    let trace = output.pop().unwrap();
    assert!(trace.starts_with("Trace: here\n") && trace.contains("deep"), "{trace}");
    let timed = output.iter().position(|line| line.starts_with("t: ")).unwrap();
    assert!(output[timed].ends_with(" ms"), "{}", output[timed]);
    output.remove(timed);
    assert_eq!(
        output,
        [
            "[1, 'two', [3, {four: 4}]] {a: 1, b: 'b'} Swatch {name: 'red'} ƒ make() null { x: 1, y: 2 }",
            "Paper.js is 15 years and 0.5%, {x: 1} more",
            "Assertion failed: shown 2",
            "default: 1",
            "default: 2",
            "other: 1",
            "default: 1",
            "outer",
            "  in",
            "    deeper",
            "out",
            "Timer 't' already exists",
            "Timer 't' does not exist",
            "│ (index) │ a │ b │\n│ 0       │ 1 │ 2 │\n│ 1       │ 3 │   │",
            "printed",
        ]
    );
}

/// The console writes what has no `toString()`, or one that throws, by its members, typed arrays,
/// maps and sets by their items, and DOM objects by their getters.
fn the_console_writes_any_value<E: Engine>() {
    let mut runtime = Runtime::<E>::new().unwrap();
    let scope = runtime.create_scope(800.0, 600.0).unwrap();
    runtime
        .execute(
            &scope,
            "console.log(Object.assign(Object.create(null), { a: 1 }), { toString() { throw new Error('no') } })\n\
             console.log(new Uint8Array([1, 2, 3]), new Map([['a', 1]]), new Set([1, 2]), async function* stream() {})\n\
             console.log(new DOMPoint(1, 2))\n\
             console.log(new Float64Array(150))\n\
             console.log(new DOMException('Gone.', 'NotFoundError'))",
        )
        .unwrap();
    let output = runtime.take_output();
    assert_eq!(
        output[..3],
        [
            "{a: 1} {toString: ƒ toString()}",
            "Uint8Array(3) [1, 2, 3] Map(1) {'a' => 1} Set(2) {1, 2} ƒ stream()",
            "DOMPoint {x: 1, y: 2, z: 0, w: 1}"
        ]
    );
    assert!(output[3].starts_with("Float64Array(150) [0, 0,") && output[3].ends_with(", 0, … 50 more]"), "{}", output[3]);
    assert!(output[4].starts_with("NotFoundError: Gone."), "{}", output[4]);
}

fn structured_clone_copies_as_browsers_do<E: Engine>() {
    let mut runtime = Runtime::<E>::new().unwrap();
    let scope = runtime.create_scope(800.0, 600.0).unwrap();
    runtime
        .execute(
            &scope,
            "const shared = { n: 1 }\n\
             const original = { list: [shared, shared], when: new Date(5), pattern: /a/gi, map: new Map([[1, shared]]), set: new Set(['x']), bytes: new Uint8Array([1, 2]), matrix: new DOMMatrix().translate(3, 4) }\n\
             original.self = original\n\
             const copy = structuredClone(original)\n\
             console.log(copy !== original, copy.self === copy, copy.list[0] === copy.list[1], copy.list[0] !== shared, copy.map.get(1) === copy.list[0])\n\
             console.log(copy.when.getTime(), String(copy.pattern), copy.set.has('x'), copy.bytes.join(), copy.matrix instanceof DOMMatrix, copy.matrix.e)\n\
             const error = structuredClone(new RangeError('far'))\n\
             console.log(error instanceof RangeError, error.message, structuredClone(5), structuredClone('text'))\n\
             const thrown = f => { try { f() } catch (e) { return e.name } }\n\
             console.log(thrown(() => structuredClone(() => 1)), thrown(() => structuredClone({ f: Symbol() })), thrown(() => structuredClone(new OffscreenCanvas(1, 1))))\n\
             const buffer = new Uint8Array([1, 2]).buffer\n\
             const moved = structuredClone({ view: new Uint8Array(buffer) }, { transfer: [buffer] })\n\
             console.log(buffer.byteLength, moved.view.join(), thrown(() => structuredClone(1, { transfer: [{}] })))",
        )
        .unwrap();
    assert_eq!(
        runtime.take_output(),
        [
            // Shared and cyclic objects stay so.
            "true true true true true",
            "5 /a/gi true 1,2 true 3",
            "true far 5 text",
            "DataCloneError DataCloneError DataCloneError",
            // A transferred buffer is the copy's alone.
            "0 1,2 DataCloneError",
        ]
    );
}

fn navigator_speaks_the_apps_language<E: Engine>() {
    let mut runtime = Runtime::<E>::new().unwrap();
    let scope = runtime.create_scope(800.0, 600.0).unwrap();
    runtime.execute(&scope, "console.log(navigator.language, navigator.languages.join())").unwrap();
    runtime.set_script(&Setup { language: Some("de".into()), ..Setup::default() }).unwrap();
    runtime.execute(&scope, "console.log(navigator.language, navigator.languages.join())").unwrap();
    assert_eq!(runtime.take_output(), ["en-US en-US", "de de"]);
}

fn navigator_counts_the_processors<E: Engine>() {
    let mut runtime = Runtime::<E>::new().unwrap();
    let scope = runtime.create_scope(800.0, 600.0).unwrap();
    runtime.execute(&scope, "console.log(navigator.hardwareConcurrency)").unwrap();
    let processors = std::thread::available_parallelism().unwrap();
    assert_eq!(runtime.take_output(), [processors.to_string()]);
}

fn event_targets_are_the_browsers<E: Engine>() {
    let mut runtime = Runtime::<E>::new().unwrap();
    let scope = runtime.create_scope(800.0, 600.0).unwrap();
    runtime
        .execute(
            &scope,
            "class Emitter extends EventTarget { ping() { return this.dispatchEvent(new CustomEvent('ping', { detail: 42, cancelable: true })) } }\n\
             const emitter = new Emitter()\n\
             const log = []\n\
             const listener = event => log.push('a ' + event.detail + ' ' + (event.target === emitter) + ' ' + (event.currentTarget === emitter))\n\
             emitter.addEventListener('ping', listener)\n\
             emitter.addEventListener('ping', listener)\n\
             emitter.addEventListener('ping', () => log.push('once'), { once: true })\n\
             emitter.addEventListener('ping', { handleEvent(event) { log.push('handler ' + (this !== emitter)); event.preventDefault() } })\n\
             emitter.addEventListener('ping', () => { throw new Error('oops') })\n\
             const controller = new AbortController()\n\
             emitter.addEventListener('ping', () => log.push('until aborted'), { signal: controller.signal })\n\
             console.log(emitter instanceof Emitter, emitter instanceof EventTarget, emitter.ping(), log.join(', '))\n\
             log.length = 0; controller.abort(); emitter.removeEventListener('ping', listener)\n\
             console.log(emitter.ping(), log.join(', '))\n\
             const event = new Event('x', { cancelable: true })\n\
             emitter.addEventListener('x', e => { e.stopImmediatePropagation(); e.preventDefault() }, { passive: true })\n\
             emitter.addEventListener('x', () => log.push('never'))\n\
             console.log(emitter.dispatchEvent(event), event.defaultPrevented, event.eventPhase, Event.AT_TARGET, controller.signal instanceof EventTarget)\n\
             const thrown = f => { try { f() } catch (e) { return e.name } }\n\
             console.log(thrown(() => EventTarget()), thrown(() => emitter.dispatchEvent({})), Object.prototype.toString.call(event))",
        )
        .unwrap();
    // Reports go on with where the error was, as each engine writes it.
    let report = "Uncaught Error: oops";
    let output: Vec<String> = runtime.take_output().into_iter().map(|line| if line.starts_with(report) { report.to_owned() } else { line }).collect();
    assert_eq!(
        output,
        [
            // A listener added twice runs once; one that throws is reported, and the others run.
            "Uncaught Error: oops",
            "true true false a 42 true true, once, handler true, until aborted",
            "Uncaught Error: oops",
            "false handler true",
            // A passive listener can't prevent the default.
            "true false 0 2 true",
            "TypeError TypeError [object Event]",
        ]
    );
}

fn the_clipboard_needs_the_app<E: Engine>() {
    let mut runtime = Runtime::<E>::new().unwrap();
    let scope = runtime.create_scope(800.0, 600.0).unwrap();
    runtime
        .execute(
            &scope,
            "navigator.clipboard.readText().catch(e => console.log(e.name))\n\
             navigator.clipboard.writeText('x').catch(e => console.log(e.name))",
        )
        .unwrap();
    assert_eq!(runtime.take_output(), ["NotAllowedError", "NotAllowedError"]);
}

/// A WebSocket server on a free local port that echoes what it's sent, for one connection; its
/// address.
fn echo_server() -> String {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let address = format!("ws://{}", listener.local_addr().unwrap());
    std::thread::spawn(move || {
        let (stream, _) = listener.accept().unwrap();
        let mut socket = tungstenite::accept(stream).unwrap();
        while let Ok(message) = socket.read() {
            if message.is_text() || message.is_binary() {
                socket.send(message).unwrap();
            }
        }
    });
    address
}

fn web_sockets_talk<E: Engine>() {
    let mut runtime = Runtime::<E>::new().unwrap();
    let scope = runtime.create_scope(800.0, 600.0).unwrap();
    let source = format!(
        "const socket = new WebSocket('{}')\n\
         socket.binaryType = 'arraybuffer'\n\
         console.log(socket.readyState === WebSocket.CONNECTING, socket instanceof EventTarget)\n\
         socket.onopen = () => {{ console.log('open', socket.readyState); socket.send('hello'); socket.send(new Uint8Array([1, 2, 3])) }}\n\
         let count = 0\n\
         socket.addEventListener('message', event => {{\n\
             console.log('message', typeof event.data === 'string' ? event.data : new Uint8Array(event.data).join(), event instanceof MessageEvent)\n\
             if (++count === 2) socket.close(4001, 'done')\n\
         }})\n\
         socket.onclose = event => console.log('close', event.code, event.reason, event.wasClean, socket.readyState, event instanceof CloseEvent)",
        echo_server()
    );
    runtime.execute(&scope, &source).unwrap();
    let started = std::time::Instant::now();
    while runtime.is_running() && started.elapsed() < std::time::Duration::from_secs(5) {
        runtime.run_timers(started.elapsed().as_secs_f64() * 1000.0).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(5));
    }
    assert_eq!(runtime.take_output(), ["true true", "open 1", "message hello true", "message 1,2,3 true", "close 4001 done true 3 true"]);
    assert!(!runtime.is_running(), "a closed socket keeps the script running no more");
}

/// An `EventSource` reads the events of the stream as the standard parses them, connects again
/// once it ends, with the last event's id, and fails on an answer that's no event stream.
fn event_sources_read_streams_and_reconnect<E: Engine>() {
    use std::io::{BufRead, BufReader, Write};
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let address = format!("http://{}", listener.local_addr().unwrap());
    let (sent, ids) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        for (i, stream) in listener.incoming().take(2).enumerate() {
            let mut stream = stream.unwrap();
            let mut reader = BufReader::new(stream.try_clone().unwrap());
            let mut id = None;
            loop {
                let mut header = String::new();
                reader.read_line(&mut header).unwrap();
                if header.trim().is_empty() {
                    break;
                }
                if let Some(value) = header.strip_prefix("last-event-id:").or_else(|| header.strip_prefix("Last-Event-ID:")) {
                    id = Some(value.trim().to_owned());
                }
            }
            sent.send(id).unwrap();
            let answer = if i == 0 {
                "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream; charset=utf-8\r\nConnection: close\r\n\r\n\u{feff}: a comment\r\nretry: 50\r\nid: 1\r\ndata: one\r\ndata:two\r\n\r\nevent: custom\ndata: three\rid\n\ndata\n\nid: 2\n\n"
            } else {
                "HTTP/1.1 204 No Content\r\nConnection: close\r\n\r\n"
            };
            stream.write_all(answer.as_bytes()).unwrap();
        }
    });
    let mut runtime = Runtime::<E>::new().unwrap();
    runtime
        .eval(&format!(
            "const source = new EventSource('{address}/events')\n\
             const log = event => console.log(event.type, JSON.stringify(event.data), event.lastEventId, event.origin === '{address}', source.readyState)\n\
             source.onopen = event => console.log('open', source.readyState)\n\
             source.onmessage = log\n\
             source.addEventListener('custom', log)\n\
             source.onerror = event => console.log('error', source.readyState)"
        ))
        .unwrap();
    let started = std::time::Instant::now();
    while runtime.is_running() && started.elapsed() < std::time::Duration::from_secs(5) {
        runtime.run_timers(started.elapsed().as_secs_f64() * 1000.0).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(5));
    }
    assert_eq!(
        runtime.take_output(),
        ["open 1", "message \"one\\ntwo\" 1 true 1", "custom \"three\"  true 1", "message \"\"  true 1", "error 0", "error 2"],
        "an empty id field clears the id, and one without data dispatches nothing"
    );
    assert_eq!(ids.try_iter().collect::<Vec<_>>(), [None, Some("2".to_owned())]);
    assert!(!runtime.is_running(), "a failed connection keeps the script running no more");
}

fn web_sockets_drop_what_they_send_while_the_server_closes_them<E: Engine>() {
    // A server that says `go` and closes the socket at once, then keeps the connection a while:
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let address = format!("ws://{}", listener.local_addr().unwrap());
    std::thread::spawn(move || {
        let (stream, _) = listener.accept().unwrap();
        let mut socket = tungstenite::accept(stream).unwrap();
        socket.write(tungstenite::Message::text("go")).unwrap();
        socket.close(Some(tungstenite::protocol::CloseFrame { code: 1000.into(), reason: "bye".into() })).unwrap();
        while socket.read().is_ok() {}
        std::thread::sleep(std::time::Duration::from_millis(300));
    });
    let mut runtime = Runtime::<E>::new().unwrap();
    let scope = runtime.create_scope(800.0, 600.0).unwrap();
    let source = format!(
        "const socket = new WebSocket('{address}')\n\
         socket.onmessage = event => socket.send('late')\n\
         socket.onerror = () => console.log('error')\n\
         socket.onclose = event => console.log('close', event.code, event.reason, event.wasClean)"
    );
    runtime.execute(&scope, &source).unwrap();
    run_until_done(&mut runtime);
    assert_eq!(runtime.take_output(), ["close 1000 bye true"]);
}

fn web_sockets_that_cant_connect_close<E: Engine>() {
    // A port nothing listens on.
    let port = std::net::TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port();
    let mut runtime = Runtime::<E>::new().unwrap();
    let scope = runtime.create_scope(800.0, 600.0).unwrap();
    let source = format!(
        "const socket = new WebSocket('ws://127.0.0.1:{port}')\n\
         socket.onerror = event => console.log('error', event.type)\n\
         socket.onclose = event => console.log('close', event.code, event.wasClean)\n\
         const thrown = f => {{ try {{ f() }} catch (e) {{ return e.name }} }}\n\
         console.log(thrown(() => new WebSocket('ftp://x')), thrown(() => socket.send('early')), thrown(() => socket.close(1001)))"
    );
    runtime.execute(&scope, &source).unwrap();
    let started = std::time::Instant::now();
    while runtime.is_running() && started.elapsed() < std::time::Duration::from_secs(5) {
        runtime.run_timers(started.elapsed().as_secs_f64() * 1000.0).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(5));
    }
    let output = runtime.take_output();
    assert_eq!(output.first().map(String::as_str), Some("SyntaxError InvalidStateError InvalidAccessError"));
    // The console says why; the events don't.
    assert!(output.get(1).is_some_and(|line| line.starts_with(&format!("WebSocket ws://127.0.0.1:{port}/: "))), "{output:?}");
    assert_eq!(output.get(2..), Some(&["error error".to_owned(), "close 1006 false".to_owned()][..]));
}

/// Runs the runtime's timers until it stops running, for 30 seconds at most: Boa starts each
/// worker's Paper.js slowly when the tests run in parallel.
fn run_until_done<E: Engine>(runtime: &mut Runtime<E>) {
    let started = std::time::Instant::now();
    while runtime.is_running() && started.elapsed() < std::time::Duration::from_secs(30) {
        runtime.run_timers(started.elapsed().as_secs_f64() * 1000.0).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(5));
    }
}

/// The scripts that open a `SharedWorker` of the same script and name share one worker, each
/// through its own port; another name is another worker.
fn shared_workers_are_shared_by_scripts<E: Engine>(name: &str) {
    let folder = std::env::temp_dir().join(format!("scriptographer-shared-workers-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&folder);
    std::fs::create_dir_all(&folder).unwrap();
    std::fs::write(
        folder.join("count.js"),
        "let count = 0\n\
         onconnect = event => {\n\
             const [port] = event.ports\n\
             port.onmessage = message => port.postMessage(`${message.data} ${++count} ${self.name} ${typeof postMessage}`)\n\
         }",
    )
    .unwrap();
    let open = |worker: &str, said: &str| {
        let mut runtime = Runtime::<E>::new().unwrap();
        runtime.set_script(&Setup { file: Some(folder.join("script.js").to_string_lossy().into_owned()), ..Setup::default() }).unwrap();
        runtime
            .eval(&format!(
                "const worker = new SharedWorker('count.js', '{worker}')\n\
                 worker.port.onmessage = event => {{ console.log(event.data); worker.port.close() }}\n\
                 worker.port.postMessage('{said}')"
            ))
            .unwrap();
        runtime
    };
    let mut first = open(name, "one");
    run_until_done(&mut first);
    let mut second = open(name, "two");
    run_until_done(&mut second);
    let mut other = open(&format!("{name}-other"), "three");
    run_until_done(&mut other);
    assert_eq!(first.take_output(), [format!("one 1 {name} undefined")]);
    assert_eq!(second.take_output(), [format!("two 2 {name} undefined")], "the same worker, which counts on");
    assert_eq!(other.take_output(), [format!("three 1 {name}-other undefined")]);
}

fn workers_run_scripts_on_their_threads<E: Engine>(name: &str) {
    let folder = std::env::temp_dir().join(format!("scriptographer-workers-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&folder);
    std::fs::create_dir_all(&folder).unwrap();
    std::fs::write(folder.join("helper.js"), "function double(n) { return n * 2 }").unwrap();
    std::fs::write(
        folder.join("echo.js"),
        "importScripts('helper.js')\n\
         self.onmessage = event => {\n\
             postMessage({ doubled: double(event.data.n), shared: event.data.list[0] === event.data.list[1], name: self.name })\n\
             if (event.data.n === 2) close()\n\
         }\n\
         setTimeout(() => { throw new Error('later') }, 0)\n\
         console.log('worker started', self instanceof EventTarget || typeof self.addEventListener)",
    )
    .unwrap();
    let mut runtime = Runtime::<E>::new().unwrap();
    runtime.set_script(&Setup { file: Some(folder.join("script.js").to_string_lossy().into_owned()), ..Setup::default() }).unwrap();
    let scope = runtime.create_scope(800.0, 600.0).unwrap();
    runtime
        .execute(
            &scope,
            "const worker = new Worker('echo.js', { name: 'echo' })\n\
             worker.onmessage = event => console.log('reply', JSON.stringify(event.data))\n\
             worker.onerror = event => { console.log('error', event instanceof ErrorEvent, event.message.includes('later')); event.preventDefault() }\n\
             const list = [{}]\n\
             list.push(list[0])\n\
             worker.postMessage({ n: 1, list })\n\
             worker.postMessage({ n: 2, list })",
        )
        .unwrap();
    run_until_done(&mut runtime);
    assert_eq!(
        runtime.take_output(),
        [
            "worker started function",
            "reply {\"doubled\":2,\"shared\":true,\"name\":\"echo\"}",
            "error true true",
            "reply {\"doubled\":4,\"shared\":true,\"name\":\"echo\"}",
        ]
    );
    assert!(!runtime.is_running(), "a closed worker keeps its parent running no more");
    // A worker that never returns stops when it's terminated.
    std::fs::write(folder.join("forever.js"), "while (true) {}").unwrap();
    runtime.execute(&scope, "const forever = new Worker('forever.js')\nsetTimeout(() => forever.terminate(), 50)").unwrap();
    run_until_done(&mut runtime);
    assert!(!runtime.is_running(), "the terminated worker is gone");
    std::fs::remove_dir_all(&folder).unwrap();
}

/// A message transfers buffers too: the receiver gets their bytes, the sender's are detached.
fn messages_transfer_buffers<E: Engine>() {
    let mut runtime = Runtime::<E>::new().unwrap();
    runtime
        .eval(
            "const { port1, port2 } = new MessageChannel()\n\
             port2.onmessage = event => console.log('got', event.data.bytes.byteLength, new Uint8Array(event.data.bytes).join())\n\
             const bytes = new Uint8Array([1, 2, 3]).buffer\n\
             port1.postMessage({ bytes }, [bytes])\n\
             const thrown = f => { try { f() } catch (e) { return e.name } }\n\
             console.log('sent', bytes.byteLength, thrown(() => port1.postMessage(1, [{}])), thrown(() => port1.postMessage(1, [bytes, bytes])))",
        )
        .unwrap();
    runtime.run_timers(0.0).unwrap();
    assert_eq!(runtime.take_output(), ["sent 0 DataCloneError DataCloneError", "got 3 1,2,3"]);
}

fn message_channels_join_ports_in_a_script_and_across_workers<E: Engine>(name: &str) {
    let folder = std::env::temp_dir().join(format!("scriptographer-ports-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&folder);
    std::fs::create_dir_all(&folder).unwrap();
    // One worker speaks on a port it's sent, the other listens on the other and tells its parent.
    std::fs::write(folder.join("speak.js"), "onmessage = event => { event.ports[0].postMessage('hello from ' + self.name); close() }").unwrap();
    std::fs::write(
        folder.join("listen.js"),
        "onmessage = event => {\n\
             event.ports[0].onmessage = message => { postMessage([message.data, event.data.port === event.ports[0]]); close() }\n\
         }",
    )
    .unwrap();
    let mut runtime = Runtime::<E>::new().unwrap();
    runtime.set_script(&Setup { file: Some(folder.join("script.js").to_string_lossy().into_owned()), ..Setup::default() }).unwrap();
    let scope = runtime.create_scope(800.0, 600.0).unwrap();
    runtime
        .execute(
            &scope,
            "const local = new MessageChannel()\n\
             local.port2.onmessage = event => { console.log('local', event.data.n, event.data.point instanceof DOMPoint); local.port2.close() }\n\
             local.port1.postMessage({ n: 1, point: new DOMPoint(1, 2) })\n\
             try { local.port1.postMessage(0, [local.port1]) } catch (e) { console.log(e.name) }\n\
             try { local.port1.postMessage(0, [{}]) } catch (e) { console.log(e.name) }\n\
             const speaker = new Worker('speak.js', { name: 'speaker' })\n\
             const listener = new Worker('listen.js')\n\
             listener.onmessage = event => console.log('heard', JSON.stringify(event.data))\n\
             const { port1, port2 } = new MessageChannel()\n\
             listener.postMessage({ port: port2 }, [port2])\n\
             speaker.postMessage(null, { transfer: [port1] })\n\
             port1.postMessage('sent ports take nothing')\n\
             try { speaker.postMessage(null, [port1]) } catch (e) { console.log('again', e.name) }",
        )
        .unwrap();
    run_until_done(&mut runtime);
    assert_eq!(
        runtime.take_output(),
        ["DataCloneError", "DataCloneError", "again DataCloneError", "local 1 true", "heard [\"hello from speaker\",true]"]
    );
    assert!(!runtime.is_running(), "with the workers closed and the started port too, nothing is left to run");
    std::fs::remove_dir_all(&folder).unwrap();
}

fn font_faces_give_canvases_fonts_by_the_scripts_names<E: Engine>() {
    let mut runtime = Runtime::<E>::new().unwrap();
    let scope = runtime.create_scope(800.0, 600.0).unwrap();
    let font = concat!(env!("CARGO_MANIFEST_DIR"), "/../../assets/fonts/SourceSerif4-Regular.ttf");
    runtime
        .execute(
            &scope,
            &format!(
                "const ctx = new OffscreenCanvas(10, 10).getContext('2d')\n\
                 const width = font => {{ ctx.font = font; return ctx.measureText('Hello').width }}\n\
                 const before = width('20px \"My Face\"')\n\
                 const face = new FontFace('My Face', await new LocalFile({font:?}).arrayBuffer())\n\
                 face.loaded.then(() => {{\n\
                     console.log(face.status, width('20px \"My Face\"') === before, fonts.check('20px \"My Face\"'))\n\
                     fonts.add(face)\n\
                 }})\n\
                 fonts.ready.then(() => setTimeout(() => {{\n\
                     console.log(fonts.size, width('20px \"My Face\"') === width('20px \"Source Serif 4\"'), width('20px \"My Face\"') !== before)\n\
                     fonts.delete(face)\n\
                     console.log(width('20px \"My Face\"') === before)\n\
                 }}))\n\
                 new FontFace('Nothing', new Uint8Array([1, 2, 3])).loaded.catch(e => console.log(e.name))"
            ),
        )
        .unwrap();
    run_until_done(&mut runtime);
    assert_eq!(
        runtime.take_output(),
        [
            // Loaded but not added, the name is no font's yet:
            "loaded true true",
            "SyntaxError",
            "1 true true",
            // Deleted, it's no longer:
            "true",
        ]
    );
}

/// `fonts.check()` and `load()` read the families of a CSS `font` as canvases do, names of several
/// words too, and an invalid one is a `SyntaxError`.
fn font_sets_match_the_families_of_a_font<E: Engine>() {
    let mut runtime = Runtime::<E>::new().unwrap();
    let scope = runtime.create_scope(800.0, 600.0).unwrap();
    runtime
        .execute(
            &scope,
            "const face = new FontFace('My Face', new Uint8Array([1, 2, 3]))\n\
             face.loaded.catch(() => {\n\
                 fonts.add(face)\n\
                 console.log(fonts.check('bold 16px \"My Face\", serif'), fonts.check('16px My Face'), fonts.check('16px Other'))\n\
                 try { fonts.check('bold') } catch (e) { console.log(e.name) }\n\
                 fonts.load('nope').catch(e => console.log(e.name))\n\
             })",
        )
        .unwrap();
    run_until_done(&mut runtime);
    assert_eq!(runtime.take_output(), ["false false true", "SyntaxError", "SyntaxError"]);
}

fn canvas_text_is_placed_by_its_anchor<E: Engine>() {
    let mut runtime = Runtime::<E>::new().unwrap();
    let scope = runtime.create_scope(800.0, 600.0).unwrap();
    let font = concat!(env!("CARGO_MANIFEST_DIR"), "/../../assets/fonts/SourceSerif4-Regular.ttf");
    runtime
        .execute(
            &scope,
            &format!(
                "fonts.add(await new FontFace('Serif', await new LocalFile({font:?}).arrayBuffer()).loaded)\n\
                 await new Promise(resolve => setTimeout(resolve))\n\
                 const canvas = new OffscreenCanvas(100, 50)\n\
                 const ctx = canvas.getContext('2d')\n\
                 ctx.font = '40px Serif'\n\
                 const near = (a, b) => Math.abs(a - b) < 0.01\n\
                 const m = ctx.measureText('Hi')\n\
                 console.log(near(m.emHeightAscent + m.emHeightDescent, 40), m.alphabeticBaseline === -0 || m.alphabeticBaseline === 0, m.hangingBaseline > 0)\n\
                 ctx.textAlign = 'right'\n\
                 const right = ctx.measureText('Hi')\n\
                 ctx.textAlign = 'start'\n\
                 ctx.direction = 'rtl'\n\
                 const rtl = ctx.measureText('Hi')\n\
                 console.log(near(right.actualBoundingBoxLeft, m.actualBoundingBoxLeft + m.width), near(rtl.actualBoundingBoxLeft, right.actualBoundingBoxLeft))\n\
                 ctx.direction = 'ltr'\n\
                 ctx.textBaseline = 'top'\n\
                 const top = ctx.measureText('Hi')\n\
                 console.log(near(top.emHeightAscent, 0), near(top.alphabeticBaseline, -m.emHeightAscent))\n\
                 ctx.fillText('Hi', 0, 0, 0)\n\
                 console.log([...ctx.getImageData(0, 0, 100, 50).data].every(n => n === 0))\n\
                 ctx.letterSpacing = '1PX'\n\
                 console.log(ctx.letterSpacing, ctx.lang, Object.is(ctx.measureText('').width, 0))"
            ),
        )
        .unwrap();
    run_until_done(&mut runtime);
    assert_eq!(
        runtime.take_output(),
        [
            // The em box is as tall as the font's size, the hanging baseline above the alphabetic one.
            "true true true",
            // Right-aligned, or started right to left, the text ends at the anchor.
            "true true",
            // Hung from the top of the em box.
            "true true",
            // A `maxWidth` of 0 draws nothing.
            "true",
            "1px inherit true",
        ]
    );
}

fn canvases_encode_transfer_and_stay_opaque<E: Engine>() {
    let mut runtime = Runtime::<E>::new().unwrap();
    let scope = runtime.create_scope(800.0, 600.0).unwrap();
    runtime
        .execute(
            &scope,
            "const canvas = new OffscreenCanvas(4, 2)\n\
             const ctx = canvas.getContext('2d')\n\
             ctx.fillStyle = 'red'\n\
             ctx.fillRect(0, 0, 4, 2)\n\
             const head = async (type, quality) => {\n\
                 const blob = await canvas.convertToBlob({ type, quality })\n\
                 return blob.type + ' ' + [...new Uint8Array(await blob.arrayBuffer())].slice(0, 4).join(',')\n\
             }\n\
             console.log(await head('image/jpeg', 0.5), await head('image/webp'), await head('image/nope'))\n\
             await new OffscreenCanvas(0, 2).convertToBlob().catch(e => console.log(e.name))\n\
             try { new OffscreenCanvas(1, 1).transferToImageBitmap() } catch (e) { console.log(e.name) }\n\
             ctx.translate(1, 0)\n\
             const bitmap = canvas.transferToImageBitmap()\n\
             const pixel = (ctx, x, y) => [...ctx.getImageData(x, y, 1, 1).data].join(',')\n\
             console.log(bitmap.width, bitmap.height, pixel(ctx, 0, 0), ctx.getTransform().e)\n\
             const other = new OffscreenCanvas(4, 2).getContext('2d')\n\
             other.drawImage(bitmap, 0, 0)\n\
             console.log(pixel(other, 1, 1))\n\
             const opaque = new OffscreenCanvas(2, 2).getContext('2d', { alpha: false, willReadFrequently: true })\n\
             const { alpha, colorSpace, willReadFrequently } = opaque.getContextAttributes()\n\
             console.log(alpha, colorSpace, willReadFrequently, pixel(opaque, 0, 0))\n\
             opaque.fillStyle = 'rgba(255, 0, 0, 0.5)'\n\
             opaque.fillRect(0, 0, 1, 1)\n\
             opaque.clearRect(1, 0, 1, 1)\n\
             opaque.putImageData(new ImageData(1, 1), 0, 1)\n\
             console.log(pixel(opaque, 0, 0), pixel(opaque, 1, 0), pixel(opaque, 0, 1))",
        )
        .unwrap();
    run_until_done(&mut runtime);
    assert_eq!(
        runtime.take_output(),
        [
            // JPEG's and WebP's signatures; another type is PNG.
            "image/jpeg 255,216,255,224 image/webp 82,73,70,70 image/png 137,80,78,71",
            "IndexSizeError",
            "InvalidStateError",
            // The canvas is cleared, its state kept.
            "4 2 0,0,0,0 1",
            "255,0,0,255",
            // Opaque canvases start black and stay opaque, half red on black, cleared to black.
            "false srgb true 0,0,0,255",
            "128,0,0,255 0,0,0,255 0,0,0,255",
        ]
    );
}

fn text_metrics_give_clusters_bounds_and_offsets<E: Engine>() {
    let mut runtime = Runtime::<E>::new().unwrap();
    let scope = runtime.create_scope(800.0, 600.0).unwrap();
    runtime
        .execute(
            &scope,
            "const ctx = new OffscreenCanvas(100, 60).getContext('2d')\n\
             ctx.font = '40px \"Source Sans 3\"'\n\
             const near = (a, b) => Math.abs(a - b) < 0.01\n\
             const tm = ctx.measureText('AB\\r\\nC')\n\
             const clusters = tm.getTextClusters()\n\
             const [a, b] = clusters\n\
             console.log(tm instanceof TextMetrics, clusters.map(c => c.start + '-' + c.end).join(' '), a.text, near(b.x, ctx.measureText('A').width))\n\
             const box = tm.getActualBoundingBox(0, 5)\n\
             console.log(near(box.x, -tm.actualBoundingBoxLeft), near(box.width, tm.actualBoundingBoxLeft + tm.actualBoundingBoxRight))\n\
             const [rect] = tm.getSelectionRects(0, 2)\n\
             console.log(near(rect.height, tm.fontBoundingBoxAscent + tm.fontBoundingBoxDescent), tm.getSelectionRects(2, 1).length)\n\
             console.log(tm.getIndexFromOffset(-5), tm.getIndexFromOffset(a.x + 1), tm.getIndexFromOffset(1000))\n\
             try { tm.getTextClusters(3, 1) } catch (e) { console.log(e.name) }\n\
             ctx.fillStyle = '#0f0'\n\
             ctx.fillTextCluster(a, 0, 0, { baseline: 'top' })\n\
             console.log(ctx.getImageData(0, 0, 100, 60).data.some((v, i) => i % 4 === 1 && v > 0))",
        )
        .unwrap();
    assert_eq!(
        runtime.take_output(),
        [
            // CR and LF are spaces by then, two clusters.
            "true 0-1 1-2 2-3 3-4 4-5 A true",
            "true true",
            "true 0",
            "0 0 5",
            "IndexSizeError",
            "true",
        ]
    );
}

fn runtimes_live_side_by_side<E: Engine>() {
    // As the app runs them: a second script starts while the first keeps running, and the first
    // stops first.
    let mut first = Runtime::<E>::new().unwrap();
    let first_scope = first.create_scope(100.0, 100.0).unwrap();
    let mut second = Runtime::<E>::new().unwrap();
    let second_scope = second.create_scope(100.0, 100.0).unwrap();
    first.execute(&first_scope, "console.log('first')").unwrap();
    second.execute(&second_scope, "console.log('second')").unwrap();
    first.execute(&first_scope, "console.log('first again')").unwrap();
    assert_eq!(first.take_output(), ["first", "first again"]);
    assert_eq!(second.take_output(), ["second"]);
    drop(first);
    second.execute(&second_scope, "console.log('second again')").unwrap();
    assert_eq!(second.take_output(), ["second again"]);
}

fn runtimes_share_nothing<E: Engine>() {
    // Each starts as Paper.js left it after loading (in V8, from one snapshot), whatever another
    // did to its own.
    let mut first = Runtime::<E>::new().unwrap();
    let first_scope = first.create_scope(100.0, 100.0).unwrap();
    first.execute(&first_scope, "globalThis.left = 1; Point.prototype.left = 1; new Path.Circle([50, 50], 10)").unwrap();
    let mut second = Runtime::<E>::new().unwrap();
    let second_scope = second.create_scope(100.0, 100.0).unwrap();
    second.execute(&second_scope, "console.log(typeof left, new Point().left, project.activeLayer.children.length)").unwrap();
    assert_eq!(second.take_output(), ["undefined undefined 0"]);
}

macro_rules! engine_tests {
    ($module:ident, $engine:ty) => {
        mod $module {
            #[test]
            fn runs_paperscript_with_console_and_paper_globals() {
                super::runs_paperscript_with_console_and_paper_globals::<$engine>();
            }

            #[test]
            fn paperscript_operators_work_on_points() {
                super::paperscript_operators_work_on_points::<$engine>();
            }

            #[test]
            fn script_errors_are_returned() {
                super::script_errors_are_returned::<$engine>();
            }

            #[test]
            fn host_function_errors_are_thrown_in_scripts() {
                super::host_function_errors_are_thrown_in_scripts::<$engine>();
            }

            #[test]
            fn intervals_run_when_due() {
                super::intervals_run_when_due::<$engine>();
            }

            #[test]
            fn local_files_read_write_and_list() {
                super::local_files_read_write_and_list::<$engine>(stringify!($module));
            }

            #[test]
            fn scripts_await_at_the_top_level() {
                super::scripts_await_at_the_top_level::<$engine>();
            }

            #[test]
            fn host_classes_can_be_subclassed() {
                super::host_classes_can_be_subclassed::<$engine>();
            }

            #[test]
            fn web_imports_are_kept_for_the_next_run() {
                super::web_imports_are_kept_for_the_next_run::<$engine>(stringify!($module));
            }

            #[test]
            fn files_are_blobs_with_a_name() {
                super::files_are_blobs_with_a_name::<$engine>();
            }

            #[test]
            fn key_listeners_keep_a_script_running_as_long_as_they_listen() {
                super::key_listeners_keep_a_script_running_as_long_as_they_listen::<$engine>();
            }

            #[test]
            fn event_handlers_are_listeners() {
                super::event_handlers_are_listeners::<$engine>();
            }

            #[test]
            fn image_data_takes_whole_rows() {
                super::image_data_takes_whole_rows::<$engine>();
            }

            #[test]
            fn keys_reach_the_document_and_the_window() {
                super::keys_reach_the_document_and_the_window::<$engine>();
            }

            #[test]
            fn scripts_have_a_dom() {
                super::scripts_have_a_dom::<$engine>();
            }

            #[test]
            fn scripts_use_todays_javascript() {
                super::scripts_use_todays_javascript::<$engine>();
            }

            #[test]
            fn promises_resolve() {
                super::promises_resolve::<$engine>();
            }

            #[test]
            fn broadcast_channels_reach_the_others_of_their_name() {
                super::broadcast_channels_reach_the_others_of_their_name::<$engine>(stringify!($module));
            }

            #[test]
            fn event_sources_read_streams_and_reconnect() {
                super::event_sources_read_streams_and_reconnect::<$engine>();
            }

            #[test]
            fn fetched_bodies_stream_as_they_arrive() {
                super::fetched_bodies_stream_as_they_arrive::<$engine>();
            }

            #[test]
            fn xml_http_requests_end_when_their_bodies_fail() {
                super::xml_http_requests_end_when_their_bodies_fail::<$engine>();
            }

            #[test]
            fn xml_http_requests_report_progress_as_bodies_arrive() {
                super::xml_http_requests_report_progress_as_bodies_arrive::<$engine>();
            }

            #[test]
            fn bodies_are_streams() {
                super::bodies_are_streams::<$engine>();
            }

            #[test]
            fn scripts_keep_their_own_files() {
                super::scripts_keep_their_own_files::<$engine>(stringify!($module));
            }

            #[test]
            fn locks_are_shared_by_scripts() {
                super::locks_are_shared_by_scripts::<$engine>(stringify!($module));
            }

            #[test]
            fn url_patterns_match_urls() {
                super::url_patterns_match_urls::<$engine>();
            }

            #[test]
            fn compression_streams_round_trip() {
                super::compression_streams_round_trip::<$engine>();
            }

            #[test]
            fn streams_pipe_through_transforms() {
                super::streams_pipe_through_transforms::<$engine>();
            }

            #[test]
            fn unhandled_rejections_are_reported() {
                super::unhandled_rejections_are_reported::<$engine>();
            }

            #[test]
            fn scripts_have_the_browsers_everyday_apis() {
                super::scripts_have_the_browsers_everyday_apis::<$engine>();
            }

            #[test]
            fn text_encodes_as_the_standard_has_it() {
                super::text_encodes_as_the_standard_has_it::<$engine>();
            }

            #[test]
            fn scripts_import_modules() {
                super::scripts_import_modules::<$engine>(stringify!($module));
            }

            #[test]
            fn scripts_fetch() {
                super::scripts_fetch::<$engine>();
            }

            #[test]
            fn scripts_send_xml_http_requests() {
                super::scripts_send_xml_http_requests::<$engine>();
            }

            #[test]
            fn scripts_import_from_the_web() {
                super::scripts_import_from_the_web::<$engine>();
            }

            #[test]
            fn scripts_have_urls() {
                super::scripts_have_urls::<$engine>();
            }

            #[test]
            fn scripts_measure_text() {
                super::scripts_measure_text::<$engine>();
            }

            #[test]
            fn canvases_have_pixels() {
                super::canvases_have_pixels::<$engine>();
            }

            #[test]
            fn canvas_contexts_are_the_browsers() {
                super::canvas_contexts_are_the_browsers::<$engine>();
            }

            #[test]
            fn matrices_read_css() {
                super::matrices_read_css::<$engine>();
            }

            #[test]
            fn round_rects_take_elliptical_radii() {
                super::round_rects_take_elliptical_radii::<$engine>();
            }

            #[test]
            fn text_takes_letter_and_word_spacing() {
                super::text_takes_letter_and_word_spacing::<$engine>();
            }

            #[test]
            fn canvases_draw() {
                super::canvases_draw::<$engine>();
            }

            #[test]
            fn fetch_classes_work_alone() {
                super::fetch_classes_work_alone::<$engine>();
            }

            #[test]
            fn timeouts_run_once() {
                super::timeouts_run_once::<$engine>();
            }

            #[test]
            fn runtimes_live_side_by_side() {
                super::runtimes_live_side_by_side::<$engine>();
            }

            #[test]
            fn canvases_draw_shadows_and_filters() {
                super::canvases_draw_shadows_and_filters::<$engine>();
            }

            #[test]
            fn canvases_draw_path2d() {
                super::canvases_draw_path2d::<$engine>();
            }

            #[test]
            fn canvas_colors_are_css_colors() {
                super::canvas_colors_are_css_colors::<$engine>();
            }

            #[test]
            fn image_bitmaps_decode_crop_flip_and_resize() {
                super::image_bitmaps_decode_crop_flip_and_resize::<$engine>();
            }

            #[test]
            fn host_functions_throw_the_browsers_exceptions() {
                super::host_functions_throw_the_browsers_exceptions::<$engine>();
            }

            #[test]
            fn canvas_properties_ignore_what_they_dont_take() {
                super::canvas_properties_ignore_what_they_dont_take::<$engine>();
            }

            #[test]
            fn geometry_classes_are_the_browsers() {
                super::geometry_classes_are_the_browsers::<$engine>();
            }

            #[test]
            fn local_storage_and_preferences_last_and_session_storage_doesnt() {
                super::local_storage_and_preferences_last_and_session_storage_doesnt::<$engine>(stringify!($module));
            }

            #[test]
            fn the_console_writes_as_browsers_do() {
                super::the_console_writes_as_browsers_do::<$engine>();
            }

            #[test]
            fn animation_frames_run_once_a_frame() {
                super::animation_frames_run_once_a_frame::<$engine>();
            }

            #[test]
            fn the_console_writes_any_value() {
                super::the_console_writes_any_value::<$engine>();
            }

            #[test]
            fn structured_clone_copies_as_browsers_do() {
                super::structured_clone_copies_as_browsers_do::<$engine>();
            }

            #[test]
            fn navigator_speaks_the_apps_language() {
                super::navigator_speaks_the_apps_language::<$engine>();
            }

            #[test]
            fn navigator_counts_the_processors() {
                super::navigator_counts_the_processors::<$engine>();
            }

            #[test]
            fn event_targets_are_the_browsers() {
                super::event_targets_are_the_browsers::<$engine>();
            }

            #[test]
            fn the_clipboard_needs_the_app() {
                super::the_clipboard_needs_the_app::<$engine>();
            }

            #[test]
            fn web_sockets_talk() {
                super::web_sockets_talk::<$engine>();
            }

            #[test]
            fn web_sockets_drop_what_they_send_while_the_server_closes_them() {
                super::web_sockets_drop_what_they_send_while_the_server_closes_them::<$engine>();
            }

            #[test]
            fn web_sockets_that_cant_connect_close() {
                super::web_sockets_that_cant_connect_close::<$engine>();
            }

            #[test]
            fn shared_workers_are_shared_by_scripts() {
                super::shared_workers_are_shared_by_scripts::<$engine>(stringify!($module));
            }

            #[test]
            fn workers_run_scripts_on_their_threads() {
                super::workers_run_scripts_on_their_threads::<$engine>(stringify!($module));
            }

            #[test]
            fn text_metrics_give_clusters_bounds_and_offsets() {
                super::text_metrics_give_clusters_bounds_and_offsets::<$engine>();
            }

            #[test]
            fn canvases_encode_transfer_and_stay_opaque() {
                super::canvases_encode_transfer_and_stay_opaque::<$engine>();
            }

            #[test]
            fn font_sets_match_the_families_of_a_font() {
                super::font_sets_match_the_families_of_a_font::<$engine>();
            }

            #[test]
            fn canvas_text_is_placed_by_its_anchor() {
                super::canvas_text_is_placed_by_its_anchor::<$engine>();
            }

            #[test]
            fn font_faces_give_canvases_fonts_by_the_scripts_names() {
                super::font_faces_give_canvases_fonts_by_the_scripts_names::<$engine>();
            }

            #[test]
            fn messages_transfer_buffers() {
                super::messages_transfer_buffers::<$engine>();
            }

            #[test]
            fn message_channels_join_ports_in_a_script_and_across_workers() {
                super::message_channels_join_ports_in_a_script_and_across_workers::<$engine>(stringify!($module));
            }

            #[test]
            fn runtimes_share_nothing() {
                super::runtimes_share_nothing::<$engine>();
            }

            #[test]
            fn css_colors_resolve_without_a_canvas() {
                super::css_colors_resolve_without_a_canvas::<$engine>();
            }
        }
    };
}

#[cfg(feature = "boa")]
engine_tests!(boa, vectorcraft_scriptographer::Boa);
#[cfg(all(feature = "v8", not(target_arch = "wasm32")))]
engine_tests!(v8, vectorcraft_scriptographer::V8);
