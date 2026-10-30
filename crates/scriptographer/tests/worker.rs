//! Scripts on threads of their own: requests go to the script's thread, replies come back.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]
#![cfg(not(target_arch = "wasm32"))]

use std::time::Duration;

use serde_json::json;
use vectorcraft_engine::Session;
use vectorcraft_scriptographer::Setup;
use vectorcraft_scriptographer::worker::{Reply, Request, Work, Worker};

const WAIT: Duration = Duration::from_secs(10);

fn session() -> Session {
    let mut s = Session::new();
    s.execute("file.new", &json!({})).unwrap();
    s.execute("shape.rectangle", &json!({"x": 10, "y": 10, "width": 30, "height": 20})).unwrap();
    s
}

fn spawn() -> Worker {
    Worker::spawn((400.0, 300.0), Setup::default()).unwrap()
}

/// Sends `work` as the script starts.
fn send(s: &Session, worker: &Worker, work: Work) {
    send_at(s, worker, 0.0, work);
}

/// Sends `work` at `now`, in milliseconds since the script started.
fn send_at(s: &Session, worker: &Worker, now: f64, work: Work) {
    let st = s.active().unwrap();
    // The styles the app gives scripts.
    let paint = &s.paint;
    let style = vectorcraft_scriptographer::host::current_style(&paint.fill, &paint.stroke, paint.stroke_width, &s.new_type_style().fill);
    worker.send(Request::Run { uid: st.uid, doc: st.doc.clone(), selection: st.selection.clone(), artboard: 0, style, now, view: None, work });
}

/// Applies the replies until `Done`, as the app does, and returns `Done`'s error.
fn settle(s: &mut Session, worker: &Worker) -> Option<String> {
    loop {
        match worker.recv(WAIT).expect("a reply") {
            Reply::Changes { patch, .. } => {
                let result = s.execute("document.patch", &patch.unwrap()).unwrap();
                let st = s.active().unwrap();
                worker.send(Request::Applied { result, doc: st.doc.clone(), selection: st.selection.clone(), behind: false });
            }
            Reply::Done { error, .. } => return error,
            Reply::Key { .. } => {}
            Reply::Ask(question) => panic!("unexpected dialog: {question}"),
        }
    }
}

fn left(s: &Session) -> f64 {
    s.active().unwrap().doc.layers[0].children().unwrap()[0].geometric_bounds().unwrap().x0
}

#[test]
fn a_script_runs_on_its_thread_and_its_changes_come_back() {
    let mut s = session();
    let worker = spawn();
    send(&s, &worker, Work::Execute("var item = project.activeLayer.firstChild\nfunction onFrame() { item.position += [10, 0] }".into()));
    assert_eq!(settle(&mut s, &worker), None);
    for (i, now) in [20.0, 40.0].into_iter().enumerate() {
        send_at(&s, &worker, now, Work::Frame);
        assert_eq!(settle(&mut s, &worker), None);
        assert_eq!(left(&s), 20.0 + 10.0 * i as f64, "each frame moves it");
    }
}

/// A script that loops forever stops when the app interrupts it, as Stop does.
#[test]
fn an_endless_loop_stops_when_interrupted() {
    let mut s = session();
    let worker = spawn();
    send(&s, &worker, Work::Execute("while (true) {}".into()));
    assert!(worker.recv(Duration::from_millis(200)).is_none(), "it loops, and the app goes on");
    worker.interrupt();
    assert!(settle(&mut s, &worker).is_some(), "it stopped with an error");
}

/// A script stopped while a host function calls back into it stops too, though it catches what
/// that function throws.
#[cfg(feature = "v8")]
#[test]
fn a_script_stopped_in_a_host_call_stops() {
    let mut s = session();
    let worker = spawn();
    send(&s, &worker, Work::Execute("for (;;) { try { structuredClone({ get a() { for (;;) {} } }) } catch {} }".into()));
    assert!(worker.recv(Duration::from_millis(200)).is_none(), "it loops");
    worker.interrupt();
    assert!(settle(&mut s, &worker).is_some(), "it stopped with an error");
}

/// A frame that adds an item to a layer of many costs little: the layer is written without its
/// children, which it keeps.
#[test]
fn adding_to_a_big_layer_is_quick() {
    let mut s = session();
    let worker = spawn();
    let script = "for (var i = 0; i < 40000; i++) new Path.Circle([i % 200 * 5, Math.floor(i / 200) * 5], 2)\n\
                  function onFrame() { new Path.Circle([0, 0], 1) }";
    send(&s, &worker, Work::Execute(script.into()));
    assert_eq!(settle(&mut s, &worker), None);
    // The first frame reads the layer's children into the project:
    send_at(&s, &worker, 20.0, Work::Frame);
    assert_eq!(settle(&mut s, &worker), None);
    let start = std::time::Instant::now();
    send_at(&s, &worker, 40.0, Work::Frame);
    assert_eq!(settle(&mut s, &worker), None);
    // Six times as long without (150 ms):
    assert!(start.elapsed() < Duration::from_millis(100), "{:?}", start.elapsed());
}

/// New items that a frame adds on top of a layer of many go in by their places, without the
/// layer's children: they cost a fraction of new items that go in below each other, which need
/// them. Timed against each other, as the machine's load varies.
#[test]
fn adding_on_top_of_a_big_layer_leaves_its_children_out() {
    let mut s = session();
    let worker = spawn();
    let script = "for (var i = 0; i < 40000; i++) new Path.Circle([i % 200 * 5, Math.floor(i / 200) * 5], 2)\n\
                  var layer = project.activeLayer\n\
                  function onFrame() { for (var i = 0; i < 2; i++) globalThis.below ? layer.insertChild(0, new Path()) : new Path() }";
    send(&s, &worker, Work::Execute(script.into()));
    assert_eq!(settle(&mut s, &worker), None);
    let mut now = 0.0;
    let mut time = |s: &mut Session, below: bool| {
        send(s, &worker, Work::Execute(format!("globalThis.below = {below}")));
        assert_eq!(settle(s, &worker), None);
        (0..4)
            .map(|_| {
                now += 20.0;
                let start = std::time::Instant::now();
                send_at(s, &worker, now, Work::Frame);
                assert_eq!(settle(s, &worker), None);
                start.elapsed().as_secs_f64()
            })
            .reduce(f64::min)
            .unwrap_or_default()
    };
    let (on_top, below) = (time(&mut s, false), time(&mut s, true));
    assert!(on_top < below / 2.0, "{on_top} s on top, {below} s below");
}

/// A frame costs little while many objects are selected: the script's selection is read in one
/// call. The quickest of a few frames, as the machine's load varies: about five times as long
/// without (14 ms).
#[test]
fn frames_with_a_big_selection_are_quick() {
    let mut s = session();
    for i in 0..20000 {
        s.execute("shape.ellipse", &json!({"x": (i % 200) * 5, "y": (i / 200) * 5, "width": 4, "height": 3})).unwrap();
    }
    s.execute("select.all", &json!({})).unwrap();
    let worker = spawn();
    send(&s, &worker, Work::Execute("function onFrame() {}".into()));
    assert_eq!(settle(&mut s, &worker), None);
    let quickest = (1..6)
        .map(|i| {
            let start = std::time::Instant::now();
            send_at(&s, &worker, 20.0 * f64::from(i), Work::Frame);
            assert_eq!(settle(&mut s, &worker), None);
            start.elapsed()
        })
        .skip(1)
        .min()
        .unwrap_or_default();
    assert!(quickest < Duration::from_millis(8), "{quickest:?}");
}

/// After an edit in a big layer, a script catches up without measuring the layer: bounds are
/// measured when it asks for them.
#[test]
fn an_edit_in_a_big_layer_costs_a_frame_little() {
    let mut s = session();
    for i in 0..20000 {
        s.execute("shape.ellipse", &json!({"x": (i % 200) * 5, "y": (i / 200) * 5, "width": 4, "height": 3})).unwrap();
    }
    let worker = spawn();
    send(&s, &worker, Work::Execute("var count = project.activeLayer.children.length\nfunction onFrame() {}".into()));
    assert_eq!(settle(&mut s, &worker), None);
    send_at(&s, &worker, 20.0, Work::Frame);
    assert_eq!(settle(&mut s, &worker), None);
    let id = s.active().unwrap().doc.layers[0].children().unwrap()[100].id.0;
    s.execute("object.move", &json!({"ids": [id], "dx": 1, "dy": 0})).unwrap();
    let start = std::time::Instant::now();
    send_at(&s, &worker, 40.0, Work::Frame);
    assert_eq!(settle(&mut s, &worker), None);
    // Measuring the layer took 11 ms in a release build:
    assert!(start.elapsed() < Duration::from_millis(5), "{:?}", start.elapsed());
}

/// A script that fills V8's heap stops with an error, where V8 would end the app.
#[cfg(feature = "v8")]
#[test]
fn a_script_that_runs_out_of_memory_stops() {
    let mut s = session();
    let worker = spawn();
    send(&s, &worker, Work::Execute("const all = []\nfor (;;) all.push(new Array(1e6).fill(1.5))".into()));
    let error = settle(&mut s, &worker).expect("an error");
    assert!(error.contains("ran out of memory"), "{error}");
}

/// A change list whose length a script made up ends its work with an error, not the app.
#[test]
fn a_made_up_change_list_is_an_error() {
    let mut s = session();
    let worker = spawn();
    send(&s, &worker, Work::Execute("project.activeLayer.firstChild.position.x += 1\nproject.takeChanges = () => ({ length: 1e18 })".into()));
    assert!(settle(&mut s, &worker).is_some(), "an error");
}

/// Stopped before its runtime is made, a script stops as soon as it runs, where the stop was lost.
#[test]
fn a_script_stopped_as_it_starts_stops() {
    let mut s = session();
    let worker = spawn();
    worker.interrupt();
    send(&s, &worker, Work::Execute("while (true) {}".into()));
    assert!(settle(&mut s, &worker).is_some(), "it stopped with an error");
}

/// A dialog waits on the script's thread for the app's answer.
#[test]
fn a_dialog_waits_for_the_answer() {
    let s = session();
    let worker = spawn();
    send(&s, &worker, Work::Execute("console.log(Dialog.confirm('Sure?'))".into()));
    let Some(Reply::Ask(question)) = worker.recv(WAIT) else { panic!("a question") };
    assert_eq!(question["message"], "Sure?");
    assert!(worker.recv(Duration::from_millis(100)).is_none(), "the script waits");
    worker.send(Request::Answer(json!(true)));
    let Some(Reply::Done { output, error: None, .. }) = worker.recv(WAIT) else { panic!("done") };
    assert_eq!(output, ["true"]);
}

/// A document that closes while a script waits on a dialog takes its project once the dialog is
/// answered.
#[test]
fn a_document_that_closes_during_a_dialog_takes_its_project() {
    let mut s = session();
    s.execute("file.new", &json!({})).unwrap();
    let worker = spawn();
    s.set_active(0);
    send(&s, &worker, Work::Execute("1".into()));
    assert_eq!(settle(&mut s, &worker), None);
    let first = s.documents()[0].uid;
    s.set_active(1);
    send(&s, &worker, Work::Execute("Dialog.alert('Wait')".into()));
    let Some(Reply::Ask(_)) = worker.recv(WAIT) else { panic!("a question") };
    worker.send(Request::Closed(first));
    worker.send(Request::Answer(json!(true)));
    assert_eq!(settle(&mut s, &worker), None);
    send(&s, &worker, Work::Execute("console.log(paper.projects.length)".into()));
    let Some(Reply::Done { output, error: None, .. }) = worker.recv(WAIT) else { panic!("done") };
    assert_eq!(output, ["1"], "the closed document's project is gone");
}

/// Text on a path that a script moves goes on moving with it after the app changes the text, as
/// when the user selects all and clears the fill.
#[test]
fn text_on_a_path_keeps_its_path_when_the_app_changes_it() {
    let mut s = session();
    let worker = spawn();
    let script = "var path = new Path.Circle([100, 100], 25)\n\
                  var text = new PathText(path)\n\
                  text.content = 'This text runs along the path.'\n\
                  function onFrame() { path.position += [10, 0] }";
    send(&s, &worker, Work::Execute(script.into()));
    assert_eq!(settle(&mut s, &worker), None);
    let path_left = |s: &Session| {
        let st = s.active().unwrap();
        st.doc.layers[0].children().unwrap().iter().find_map(|n| match &n.kind {
            vectorcraft_doc::NodeKind::Text(t) => t.kind.path_span().and(n.geometric_bounds()).map(|b| b.x0),
            _ => None,
        })
    };
    send_at(&s, &worker, 20.0, Work::Frame);
    assert_eq!(settle(&mut s, &worker), None);
    let before = path_left(&s).expect("the text on its path");
    s.execute("select.all", &json!({})).unwrap();
    s.execute("paint.setFill", &json!({"none": true})).unwrap();
    send_at(&s, &worker, 40.0, Work::Frame);
    assert_eq!(settle(&mut s, &worker), None);
    assert!(path_left(&s).unwrap() > before + 5.0, "the text moves on with its path");
}

/// New text takes the style the app's Type tool gives new type, a fill without a stroke, while new
/// paths take the app's current paint, a white fill and a black stroke by default.
#[test]
fn new_text_takes_the_text_style_and_new_paths_the_current_style() {
    let mut s = session();
    let worker = spawn();
    send(&s, &worker, Work::Execute("new Path.Rectangle([0, 0], [10, 10])\nnew PointText({ point: [20, 20], content: 'Hi' })".into()));
    assert_eq!(settle(&mut s, &worker), None);
    let st = s.active().unwrap();
    let nodes = st.doc.layers[0].children().unwrap();
    let text = nodes.iter().find_map(|n| match &n.kind {
        vectorcraft_doc::NodeKind::Text(t) => Some(t.runs[0].style.clone()),
        _ => None,
    });
    let text = text.expect("the text");
    assert_eq!(text.fill, vectorcraft_color::Paint::solid(vectorcraft_color::Color::BLACK), "black, as the fill is white");
    assert!(!text.has_stroke(), "no stroke");
    let path = nodes.iter().rev().find(|n| matches!(n.kind, vectorcraft_doc::NodeKind::Path { .. })).unwrap();
    assert!(!path.appearance.stroke().unwrap().paint.is_none(), "the path's stroke");
}
