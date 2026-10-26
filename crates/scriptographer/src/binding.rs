//! The document binding: each open document is a project of the scope, which reads it through
//! Paper.js's host interface, loading only what scripts touch, and whose changes go back as one
//! `document.patch` of that document. The active document's project is the scope's.

use std::collections::BTreeSet;
use std::sync::Arc;

use serde_json::{Map, Value as Json, json};
use vectorcraft_doc::{Document, Node, NodeId, NodeKind, Selection};

use crate::effects;
use crate::host::{Columns, TYPE_NAMES, definition_json, definition_keys, flags, item_json};
use crate::text;
use crate::writeback::{self, Change};
use crate::{Call, Engine, Error, Runtime, Scope, Value, define_accessor, handle, method, object};

/// The documents a runtime's projects read from, the active one's `uid`, and, once the first
/// document is bound, the host functions every project's host shares and the size of the views.
pub(crate) struct Binding<H> {
    documents: Vec<Bound<H>>,
    active: Option<u64>,
    functions: Option<H>,
    size: Option<H>,
}

/// A document and the project that reads from it: its `uid` (`DocState::uid` in the app), and its
/// active artboard, `project.activeArtboard`.
pub(crate) struct Bound<H> {
    uid: u64,
    project: H,
    pub doc: Arc<Document>,
    selection: Selection,
    artboard: usize,
}

impl<H> Default for Binding<H> {
    fn default() -> Self {
        Self { documents: Vec::new(), active: None, functions: None, size: None }
    }
}

impl<H> Binding<H> {
    /// The active document's binding.
    pub(crate) fn active(&self) -> Option<&Bound<H>> {
        self.active.and_then(|uid| self.get(uid))
    }

    fn get(&self, uid: u64) -> Option<&Bound<H>> {
        self.documents.iter().find(|b| b.uid == uid)
    }

    fn get_mut(&mut self, uid: u64) -> Option<&mut Bound<H>> {
        self.documents.iter_mut().find(|b| b.uid == uid)
    }
}

/// The changes a script made to the document `uid`, as `document.patch` params of `base`, the
/// document its project read, the new items waiting for the ids that patch gives them, and the
/// keys of the new definitions.
pub struct Patch<H> {
    pub uid: u64,
    pub base: Arc<Document>,
    pub params: Json,
    inserted: Vec<H>,
    created: Vec<String>,
}

impl<E: Engine> Runtime<E> {
    /// Makes the document `uid`, as `doc` and `selection`, the active one: its project becomes
    /// the scope's, made the first time the document is bound, and catches up with it otherwise.
    /// `project.artboards` lists the document's artboards and
    /// `project.activeArtboard` is the active one: VectorCraft's, on top of Paper.js.
    pub fn bind(&mut self, scope: &Scope<E::Handle>, uid: u64, doc: Arc<Document>, selection: Selection) -> Result<(), Error> {
        let project = self.host.borrow().binding.get(uid).map(|b| b.project.clone());
        let project = match project {
            Some(project) => {
                self.update(uid, doc, selection)?;
                project
            }
            None => self.add_project(scope, uid, doc, selection)?,
        };
        self.host.borrow_mut().binding.active = Some(uid);
        // Activating emits the projects' `deactivate` and `activate`, so only on a switch:
        self.engine.with_call(|call| {
            if !matches!(method(call, &project, "isActive", &[])?, Value::Bool(true)) {
                method(call, &project, "activate", &[])?;
            }
            Ok(())
        })
    }

    /// A project for the document `uid`: the scope's own for the first document, a new one with a
    /// view of its size for the others.
    fn add_project(&mut self, scope: &Scope<E::Handle>, uid: u64, doc: Arc<Document>, selection: Selection) -> Result<E::Handle, Error> {
        let selected = selection.objects.clone();
        let functions = self.host.borrow().binding.functions.clone();
        let functions = match functions {
            Some(functions) => functions,
            None => self.host_functions()?,
        };
        let artboards = self.engine.function("artboards", artboards)?;
        let active_artboard = self.engine.function("activeArtboard", active_artboard)?;
        let global = self.engine.global()?;
        let (paper, binding) = (&self.paper, self.host.clone());
        self.engine.with_call(|call| {
            let size = binding.borrow().binding.size.clone();
            let project = match size {
                Some(size) => {
                    let size = method(call, &size, "clone", &[])?;
                    let constructor = object(call, paper, "Project")?;
                    handle(call.construct(&constructor, &[size])?, "Project")?
                }
                None => {
                    let project = object(call, &scope.0, "project")?;
                    let view = object(call, &project, "view")?;
                    binding.borrow_mut().binding.size = Some(object(call, &view, "viewSize")?);
                    project
                }
            };
            // Each project's host is the functions', with the document's uid, which they read from it:
            let object_class = object(call, &global, "Object")?;
            let host = handle(method(call, &object_class, "create", &[Value::Js(functions.clone())])?, "host")?;
            call.set(&host, "uid", &Value::Number(uid as f64))?;
            binding.borrow_mut().binding.documents.push(Bound { uid, project: project.clone(), doc, selection, artboard: 0 });
            method(call, &project, "setHost", &[Value::Js(host)])?;
            define_accessor(call, &global, &project, "artboards", artboards, None)?;
            define_accessor(call, &global, &project, "activeArtboard", active_artboard, None)?;
            call.set(&project, "trackChanges", &Value::Bool(true))?;
            register(call, &project, &selected)?;
            Ok(project)
        })
    }

    /// The host functions the projects' hosts share, and the effects the app draws, which a
    /// runtime sets up once.
    fn host_functions(&mut self) -> Result<E::Handle, Error> {
        let get_children = self.engine.function("getChildren", get_children)?;
        let get_item = self.engine.function("getItem", get_item)?;
        let get_bounds = self.engine.function("getBounds", get_bounds)?;
        let get_definition = self.engine.function("getDefinition", get_definition)?;
        let get_definition_keys = self.engine.function("getDefinitionKeys", get_definition_keys)?;
        let get_story = self.engine.function("getStory", get_story)?;
        let get_ancestor_keys = self.engine.function("getAncestorKeys", get_ancestor_keys)?;
        let lay_out = self.engine.function("layOut", lay_out)?;
        let apply_effect = self.engine.function("apply", apply_effect)?;
        let paper = &self.paper;
        let functions = self.engine.with_call(|call| {
            let rectangle = object(call, paper, "Rectangle")?;
            let base = object(call, paper, "Base")?;
            {
                let host = call.host()?;
                let mut host = host.borrow_mut();
                host.rectangle = Some(rectangle);
                host.base = Some(base);
            }
            // The app's geometry effects draw as the app draws them, also those Paper.js has its own for:
            let effect = object(call, paper, "Effect")?;
            for (kind, label, defaults) in effects::types() {
                let parameters = defaults.into_iter().map(|(key, value)| (key, json!({ "value": value }))).collect();
                let parameters = js_value(call, &Json::Object(parameters))?;
                let props = call.new_object()?;
                call.set(&props, "type", &Value::String(kind.into()))?;
                call.set(&props, "label", &Value::String(label.into()))?;
                call.set(&props, "parameters", &parameters)?;
                call.set(&props, "onApply", &Value::Js(apply_effect.clone()))?;
                call.construct(&effect, &[Value::Js(props)])?;
            }
            // Those the scripts define from now on, the app lists while they run:
            crate::call_bundle(call, "watchEffects", &[Value::Js(effect)])?;
            let functions = call.new_object()?;
            call.set(&functions, "getChildren", &Value::Js(get_children))?;
            call.set(&functions, "getItem", &Value::Js(get_item))?;
            call.set(&functions, "getBounds", &Value::Js(get_bounds))?;
            call.set(&functions, "getDefinition", &Value::Js(get_definition))?;
            call.set(&functions, "getDefinitionKeys", &Value::Js(get_definition_keys))?;
            call.set(&functions, "getStory", &Value::Js(get_story))?;
            call.set(&functions, "getAncestorKeys", &Value::Js(get_ancestor_keys))?;
            call.set(&functions, "layOut", &Value::Js(lay_out))?;
            Ok(functions)
        })?;
        self.host.borrow_mut().binding.functions = Some(functions.clone());
        Ok(functions)
    }

    /// Lets go of the document `uid`, which closed: its project is removed, and its items with it.
    pub fn unbind(&mut self, uid: u64) -> Result<(), Error> {
        let bound = {
            let mut host = self.host.borrow_mut();
            let binding = &mut host.binding;
            if binding.active == Some(uid) {
                binding.active = None;
            }
            let at = binding.documents.iter().position(|b| b.uid == uid);
            at.map(|at| binding.documents.remove(at))
        };
        match bound {
            Some(bound) => self.engine.with_call(|call| method(call, &bound.project, "remove", &[]).map(|_| ())),
            None => Ok(()),
        }
    }

    /// The objects selected in `scope`'s project, as the script left them.
    pub fn selected_ids(&mut self, scope: &Scope<E::Handle>) -> Result<BTreeSet<NodeId>, Error> {
        self.engine.with_call(|call| {
            // In one call, as it may be large:
            let project = object(call, &scope.0, "project")?;
            let keys = crate::call_bundle(call, "getSelectedKeys", &[Value::Js(project)])?;
            let keys: Vec<f64> = serde_json::from_str(&call.to_string(&keys)?).map_err(|e| Error::Script(format!("reading the selection: {e}")))?;
            Ok(keys.into_iter().map(|key| NodeId(key as u64)).collect())
        })
    }

    /// Takes the changes the projects logged since the last call, as a patch of each document
    /// that changed, the active one's first.
    pub fn take_patches(&mut self) -> Result<Vec<Patch<E::Handle>>, Error> {
        let mut documents: Vec<(u64, E::Handle, Arc<Document>)> = {
            let host = self.host.borrow();
            host.binding.documents.iter().map(|b| (b.uid, b.project.clone(), b.doc.clone())).collect()
        };
        let active = self.host.borrow().binding.active;
        documents.sort_by_key(|(uid, ..)| Some(*uid) != active);
        // Not borrowed while the write-back calls into the script, which may need the host.
        self.engine.with_call(|call| {
            let mut patches = Vec::new();
            for (uid, project, doc) in documents {
                let changes = handle(method(call, &project, "takeChanges", &[])?, "takeChanges()")?;
                let count = number(call.get(&changes, "length")?);
                // Not sized by `count`, which the script may have made up.
                let (mut list, mut definitions) = (Vec::new(), Vec::new());
                for i in 0..count as usize {
                    let entry = object(call, &changes, &i.to_string())?;
                    match call.get(&entry, "item")? {
                        Value::Js(item) => {
                            let flags = number(call.get(&entry, "flags")?) as u32;
                            let reordered = matches!(call.get(&entry, "reordered")?, Value::Bool(true));
                            list.push(Change::read(call, item, flags, reordered)?);
                        }
                        _ => definitions.push(object(call, &entry, "definition")?),
                    }
                }
                patches.extend(writeback::patch(call, uid, &doc, list, &definitions)?);
            }
            Ok(patches)
        })
    }

    /// Whether a project changed since its changes were last taken ([`Runtime::take_patches`]):
    /// on the web, a script's Promise continuations run after the call into it has returned.
    #[cfg(target_arch = "wasm32")]
    pub fn has_changes(&mut self) -> Result<bool, Error> {
        let projects: Vec<E::Handle> = self.host.borrow().binding.documents.iter().map(|b| b.project.clone()).collect();
        self.engine.with_call(|call| {
            for project in &projects {
                if crate::truthy(&method(call, project, "hasChanges", &[])?) {
                    return Ok(true);
                }
            }
            Ok(false)
        })
    }

    /// Brings the project of the document `uid` up to `doc` and `selection`, as they are after
    /// edits made outside the script: the items of the objects that changed reload from the
    /// document the next time the script touches them. Objects that didn't change keep their
    /// items, and so does everything when the document is the one the project already reads.
    fn update(&mut self, uid: u64, doc: Arc<Document>, selection: Selection) -> Result<(), Error> {
        let selected = selection.objects.clone();
        let (changes, project) = {
            let mut host = self.host.borrow_mut();
            let Some(bound) = host.binding.get_mut(uid) else {
                return Err(Error::Script(format!("document {uid} is not bound")));
            };
            if Arc::ptr_eq(&bound.doc, &doc) && bound.selection == selection {
                return Ok(());
            }
            let changes = Columns::of_changes(&bound.doc, &bound.selection, &doc, &selection);
            (bound.doc, bound.selection) = (doc, selection);
            (changes, bound.project.clone())
        };
        if changes.is_empty() {
            return Ok(());
        }
        self.engine.with_call(|call| {
            let columns = columns_object(call, &changes)?;
            method(call, &project, "invalidate", &[Value::Js(columns)])?;
            register(call, &project, &selected)
        })
    }

    /// Gives the new items of an applied patch the ids `document.patch` returned, so later changes
    /// to them replace them instead of adding them again, and makes the patched document the one
    /// the project reads: what the script changed itself is never reloaded.
    ///
    /// The objects the patch left out (`skipped`: a drag in progress changed them, and wins) load
    /// again from the document, so the script goes on from what the drag made of them. When the
    /// document changed in other ways too since the project last caught up with it (`behind`: the
    /// patch was applied later), everything that changed loads again, and so do the new
    /// definitions, which a failed patch didn't make.
    pub fn apply_ids(&mut self, patch: Patch<E::Handle>, result: &Json, doc: Arc<Document>, selection: Selection, behind: bool) -> Result<(), Error> {
        let mut reload = Columns::default();
        let mut host = self.host.borrow_mut();
        // A document that closed meanwhile takes nothing:
        let Some(bound) = host.binding.get_mut(patch.uid) else {
            return Ok(());
        };
        if behind {
            reload = Columns::of_changes(&bound.doc, &bound.selection, &doc, &selection);
            for key in &patch.created {
                if !reload.definitions.contains(key) {
                    reload.definitions.push(key.clone());
                }
            }
        } else {
            let symbols = doc.symbol_boxes();
            for id in result["skipped"].as_array().into_iter().flatten().filter_map(Json::as_u64) {
                if let Some(node) = doc.node(NodeId(id)) {
                    reload.push(node, &selection, &symbols);
                    let changed = if node.children().is_some() { flags::CHILDREN_CHANGED } else { flags::CONTENT_CHANGED };
                    if let Some(last) = reload.flags.last_mut() {
                        *last |= changed;
                    }
                }
            }
        }
        (bound.doc, bound.selection) = (doc, selection);
        let project = bound.project.clone();
        drop(host);
        let ids = result["ids"].as_array().cloned().unwrap_or_default();
        self.engine.with_call(|call| {
            for (item, id) in patch.inserted.iter().zip(ids) {
                if let Some(id) = id.as_f64() {
                    call.set(item, "key", &Value::Number(id))?;
                }
            }
            if !reload.is_empty() {
                let columns = columns_object(call, &reload)?;
                method(call, &project, "invalidate", &[Value::Js(columns)])?;
            }
            Ok(())
        })
    }
}

impl<H> Patch<H> {
    pub(crate) fn new(uid: u64, base: Arc<Document>, params: Json, inserted: Vec<H>, created: Vec<String>) -> Self {
        Self { uid, base, params, inserted, created }
    }
}

/// Loads the selected objects' items, so the project's selection is complete even inside
/// containers the script hasn't touched.
fn register<H: Clone>(call: &mut dyn Call<H>, project: &H, selected: &[NodeId]) -> Result<(), Error> {
    for id in selected {
        method(call, project, "getItemByKey", &[Value::Number(id.0 as f64)])?;
    }
    Ok(())
}

/// A number, or 0.
pub(crate) fn number<H>(value: Value<H>) -> f64 {
    match value {
        Value::Number(n) if n.is_finite() => n,
        _ => 0.0,
    }
}

/// The node id in a key argument; `None` for `null`, the project.
fn key<H>(args: &[Value<H>]) -> Option<NodeId> {
    match args.first() {
        Some(Value::Number(n)) if n.is_finite() && *n >= 0.0 => Some(NodeId(*n as u64)),
        _ => None,
    }
}

impl<E: Engine> Runtime<E> {
    /// Makes artboard `index` of the active document its project's `activeArtboard`.
    pub fn set_artboard(&mut self, index: usize) {
        let mut host = self.host.borrow_mut();
        let binding = &mut host.binding;
        if let Some(bound) = binding.active.and_then(|uid| binding.get_mut(uid)) {
            bound.artboard = index;
        }
    }

    /// The active document, as it was when its project last caught up with it.
    pub fn document(&self) -> Option<Arc<Document>> {
        self.host.borrow().binding.active().map(|b| b.doc.clone())
    }
}

/// `project.artboards`: the document's artboards, in order, each as `{ name, bounds }`.
fn artboards<H: Clone>(call: &mut dyn Call<H>, this: &Value<H>, _args: &[Value<H>]) -> Result<Value<H>, Error> {
    let host = project_host(call, this)?;
    let boards = with_bound(call, &host, |doc, _| doc.artboards.iter().map(|a| (a.name.clone(), a.rect)).collect::<Vec<_>>())?;
    let list = boards.into_iter().map(|(name, rect)| artboard(call, name, rect).map(Value::Js)).collect::<Result<Vec<_>, _>>()?;
    Ok(Value::Js(call.new_array(&list)?))
}

/// `project.activeArtboard`: the active one of `project.artboards` (the first when there is no
/// such artboard), `null` without artboards.
fn active_artboard<H: Clone>(call: &mut dyn Call<H>, this: &Value<H>, _args: &[Value<H>]) -> Result<Value<H>, Error> {
    let host = project_host(call, this)?;
    let uid = bound_uid(call, &host)?;
    let index = call.host()?.borrow().binding.get(uid).map_or(0, |b| b.artboard);
    match with_bound(call, &host, |doc, _| doc.artboards.get(index).or(doc.artboards.first()).map(|a| (a.name.clone(), a.rect)))? {
        Some((name, rect)) => Ok(Value::Js(artboard(call, name, rect)?)),
        None => Ok(Value::Null),
    }
}

/// An artboard as scripts see it: `{ name, bounds }`.
fn artboard<H: Clone>(call: &mut dyn Call<H>, name: String, rect: vectorcraft_geom::Rect) -> Result<H, Error> {
    let rectangle = call.host()?.borrow().rectangle.clone().ok_or_else(|| Error::Script("no document is bound".into()))?;
    let board = call.new_object()?;
    call.set(&board, "name", &Value::String(name))?;
    let args = [rect.x0, rect.y0, rect.width(), rect.height()].map(Value::Number);
    let bounds = call.construct(&rectangle, &args)?;
    call.set(&board, "bounds", &bounds)?;
    Ok(board)
}

/// The host of the project `this`.
fn project_host<H: Clone>(call: &mut dyn Call<H>, this: &Value<H>) -> Result<Value<H>, Error> {
    match this {
        Value::Js(project) => call.get(project, "host"),
        _ => Err(Error::Script("not a project".into())),
    }
}

/// The `uid` of the document whose project has the host `this`.
fn bound_uid<H>(call: &mut dyn Call<H>, this: &Value<H>) -> Result<u64, Error> {
    match this {
        Value::Js(host) => match call.get(host, "uid")? {
            Value::Number(uid) if uid.is_finite() && uid >= 0.0 => Ok(uid as u64),
            _ => Err(Error::Script("not a project's host".into())),
        },
        _ => Err(Error::Script("not a project's host".into())),
    }
}

/// Runs `f` with the document and selection of the project whose host is `this`, as the host
/// functions are called.
fn with_bound<H, R>(call: &mut dyn Call<H>, this: &Value<H>, f: impl FnOnce(&Document, &Selection) -> R) -> Result<R, Error> {
    let uid = bound_uid(call, this)?;
    let host = call.host()?;
    let host = host.borrow();
    let bound = host.binding.get(uid).ok_or_else(|| Error::Script("the project's document closed".into()))?;
    Ok(f(&bound.doc, &bound.selection))
}

/// `source.getChildren(key)`: the records of a container's children, as columns.
fn get_children<H: Clone>(call: &mut dyn Call<H>, this: &Value<H>, args: &[Value<H>]) -> Result<Value<H>, Error> {
    let parent = key(args);
    let columns = with_bound(call, this, |doc, selection| Columns::of_children(doc, parent, selection))?.unwrap_or_default();
    Ok(Value::Js(columns_object(call, &columns)?))
}

/// `columns` as the object Paper.js reads them from.
fn columns_object<H: Clone>(call: &mut dyn Call<H>, columns: &Columns) -> Result<H, Error> {
    let result = call.new_object()?;
    let keys = call.new_float64_array(&columns.keys)?;
    let types = call.new_uint8_array(&columns.types)?;
    let type_names: Vec<_> = TYPE_NAMES.iter().map(|n| Value::String((*n).to_owned())).collect();
    let type_names = call.new_array(&type_names)?;
    let flags = call.new_uint16_array(&columns.flags)?;
    let names = call.new_object()?;
    for (index, name) in &columns.names {
        call.set(&names, &index.to_string(), &Value::String(name.clone()))?;
    }
    let matrices = call.new_object()?;
    for (index, matrix) in &columns.matrices {
        let values: Vec<_> = matrix.iter().map(|v| Value::Number(*v)).collect();
        let values = call.new_array(&values)?;
        call.set(&matrices, &index.to_string(), &Value::Js(values))?;
    }
    let definitions: Vec<_> = columns.definitions.iter().map(|key| Value::String(key.clone())).collect();
    let definitions = call.new_array(&definitions)?;
    for (key, value) in [
        ("keys", keys),
        ("types", types),
        ("typeNames", type_names),
        ("flags", flags),
        ("names", names),
        ("matrices", matrices),
        ("definitions", definitions),
    ] {
        call.set(&result, key, &Value::Js(value))?;
    }
    Ok(result)
}

/// `source.getItem(key)`: the item's own content as Paper.js JSON; for a frame of a thread, without
/// its story, which [`get_story`] gives, and with the frames it's `linked` with.
fn get_item<H>(call: &mut dyn Call<H>, this: &Value<H>, args: &[Value<H>]) -> Result<Value<H>, Error> {
    let id = key(args).ok_or_else(|| Error::Script("getItem: no key".into()))?;
    let json = with_bound(call, this, |doc, selection| {
        doc.node(id).map(|node| {
            let mut json = item_json(node, selection);
            if let Some(linked) = text::linked(doc, id)
                && let Some(props) = json.get_mut(1).and_then(Json::as_object_mut)
            {
                for key in ["content", "runs", "paragraphs"] {
                    props.remove(key);
                }
                props.insert("linked".into(), linked);
            }
            json
        })
    })?;
    let json = json.ok_or_else(|| Error::Script(format!("getItem: no object {id}")))?;
    Ok(Value::String(json.to_string()))
}

/// `host.getBounds(key)`: the boxes of the object `key` names, as [`crate::host::boxes`] measures
/// them, `null` when it has no geometry. Paper.js asks once it needs them.
fn get_bounds<H>(call: &mut dyn Call<H>, this: &Value<H>, args: &[Value<H>]) -> Result<Value<H>, Error> {
    let id = key(args).ok_or_else(|| Error::Script("getBounds: no key".into()))?;
    let boxes = with_bound(call, this, |doc, _| doc.node(id).map(|node| crate::host::boxes(node, &doc.symbol_boxes())))?;
    match boxes.ok_or_else(|| Error::Script(format!("getBounds: no object {id}")))? {
        Some(boxes) => Ok(Value::Js(call.new_float64_array(&boxes)?)),
        None => Ok(Value::Null),
    }
}

/// `source.getDefinition(key)`: the definition `key` names as Paper.js JSON, as
/// [`definition_json`] gives it.
fn get_definition<H>(call: &mut dyn Call<H>, this: &Value<H>, args: &[Value<H>]) -> Result<Value<H>, Error> {
    let key = match args.first() {
        Some(Value::String(key)) => key.clone(),
        _ => return Err(Error::Script("getDefinition: no key".into())),
    };
    let json = with_bound(call, this, |doc, _| definition_json(doc, &key))?;
    let json = json.ok_or_else(|| Error::Script(format!("getDefinition: no definition '{key}'")))?;
    Ok(Value::String(json.to_string()))
}

/// `source.getDefinitionKeys(class)`: the keys of the document's definitions of the class.
fn get_definition_keys<H>(call: &mut dyn Call<H>, this: &Value<H>, args: &[Value<H>]) -> Result<Value<H>, Error> {
    let class = match args.first() {
        Some(Value::String(class)) => class.clone(),
        _ => return Err(Error::Script("getDefinitionKeys: no class".into())),
    };
    let keys: Vec<_> = with_bound(call, this, |doc, _| definition_keys(doc, &class))?.into_iter().map(Value::String).collect();
    Ok(Value::Js(call.new_array(&keys)?))
}

/// `onApply({ art, item })` of the app's geometry effects, with the effect's instance as `this`:
/// the art drawn with the effect, as the app draws it. The art of an object Paper.js has no class for is the document's object the effect
/// is on, which scripts can't change. Art the effect leaves as it is comes back as it is.
fn apply_effect<H: Clone>(call: &mut dyn Call<H>, this: &Value<H>, args: &[Value<H>]) -> Result<Value<H>, Error> {
    let (Value::Js(effect), Some(Value::Js(event))) = (this, args.first()) else {
        return Err(Error::Script("onApply: no effect or event".into()));
    };
    let Value::Js(art) = &call.get(event, "art")? else {
        return Err(Error::Script("onApply: no art".into()));
    };
    let json = writeback::export(call, art)?;
    let id = match json.get(0).and_then(Json::as_str) {
        Some("HostItem") => match call.get(event, "item")? {
            Value::Js(item) => match call.get(&item, "key")? {
                Value::Number(key) => Some(NodeId(key as u64)),
                _ => None,
            },
            _ => None,
        },
        _ => None,
    };
    let effect = writeback::exported(call, effect)?;
    let output = with_active(call, |doc| {
        let art = match id {
            Some(id) => doc.node(id).cloned(),
            None => writeback::new_node(&json).ok(),
        };
        art.map(|art| effects::apply(doc, art, &effect)).transpose()
    })??;
    match output.flatten() {
        Some(output) => {
            let base = call.host()?.borrow().base.clone().ok_or_else(|| Error::Script("no document is bound".into()))?;
            method(call, &base, "importJSON", &[Value::String(output.to_string())])
        }
        None => Ok(Value::Js(art.clone())),
    }
}

/// Runs `f` with the active document.
fn with_active<H, R>(call: &mut dyn Call<H>, f: impl FnOnce(&Document) -> R) -> Result<R, Error> {
    let host = call.host()?;
    let host = host.borrow();
    let bound = host.binding.active().ok_or_else(|| Error::Script("no document is bound".into()))?;
    Ok(f(&bound.doc))
}

/// `source.getStory(key)`: the story of the thread the frame `key` is in, its runs and paragraphs as
/// Paper.js JSON, once for all its frames.
fn get_story<H>(call: &mut dyn Call<H>, this: &Value<H>, args: &[Value<H>]) -> Result<Value<H>, Error> {
    let id = key(args).ok_or_else(|| Error::Script("getStory: no key".into()))?;
    let json = with_bound(call, this, |doc, _| match doc.node(id) {
        Some(node @ Node { kind: NodeKind::Text(t), .. }) => {
            let mut props = Map::new();
            let (story, first) = text::unfolded(&text::story_view(doc, id, t), &node.appearance);
            text::story_properties(&story, &first, &mut props);
            Some(Json::Object(props))
        }
        _ => None,
    })?;
    let json = json.ok_or_else(|| Error::Script(format!("getStory: no text {id}")))?;
    Ok(Value::String(json.to_string()))
}

/// `source.layOut(json, start, key)`: the layout of a text item, by VectorCraft's text layout: of
/// the text object of `key` itself when the script didn't change it (`json` is null), else of its
/// JSON as the script holds it, starting from that text object where there is one, so what
/// Paper.js has no form for, as text wraps, stays, see Paper.js's `Project#host`. A frame of a
/// thread holds the whole story, laid out from `start`, where the frame before it ends.
fn lay_out<H: Clone>(call: &mut dyn Call<H>, this: &Value<H>, args: &[Value<H>]) -> Result<Value<H>, Error> {
    let start = match args.get(1) {
        Some(Value::Number(n)) if n.is_finite() && *n >= 0.0 => *n as usize,
        _ => 0,
    };
    let before = with_bound(call, this, |doc, _| match key(args.get(2..).unwrap_or_default()).and_then(|id| doc.node(id)) {
        Some(node @ Node { id, kind: NodeKind::Text(t), .. }) => Some(text::unfolded(&text::story_view(doc, *id, t), &node.appearance)),
        _ => None,
    })?;
    let t = match args.first() {
        Some(Value::String(json)) => {
            let json = serde_json::from_str(json).map_err(|e| Error::Script(format!("layOut: {e}")))?;
            text::text_object(&json, before.as_ref().map(|(t, first)| (t, first.as_slice())))?.0
        }
        _ => before.ok_or_else(|| Error::Script("layOut: no JSON, and no text object of that key".into()))?.0,
    };
    js_value(call, &text::layout(&t, start))
}

/// A JSON value as a JS value.
pub(crate) fn js_value<H: Clone>(call: &mut dyn Call<H>, json: &Json) -> Result<Value<H>, Error> {
    Ok(match json {
        Json::Null => Value::Null,
        Json::Bool(b) => Value::Bool(*b),
        Json::Number(n) => Value::Number(n.as_f64().unwrap_or(0.0)),
        Json::String(s) => Value::String(s.clone()),
        Json::Array(list) => {
            let values = list.iter().map(|v| js_value(call, v)).collect::<Result<Vec<_>, _>>()?;
            Value::Js(call.new_array(&values)?)
        }
        Json::Object(map) => {
            let object = call.new_object()?;
            for (key, value) in map {
                let value = js_value(call, value)?;
                call.set(&object, key, &value)?;
            }
            Value::Js(object)
        }
    })
}

/// `source.getAncestorKeys(key)`: the keys from the layer down to the item's parent.
fn get_ancestor_keys<H>(call: &mut dyn Call<H>, this: &Value<H>, args: &[Value<H>]) -> Result<Value<H>, Error> {
    let id = key(args).ok_or_else(|| Error::Script("getAncestorKeys: no key".into()))?;
    let mut ancestry = with_bound(call, this, |doc, _| doc.ancestry(id))?.unwrap_or_default();
    ancestry.pop();
    let keys: Vec<_> = ancestry.iter().map(|id| Value::Number(id.0 as f64)).collect();
    Ok(Value::Js(call.new_array(&keys)?))
}

/// The node `id` of `doc`, for write-back.
pub(crate) fn node(doc: &Document, id: NodeId) -> Result<&Node, Error> {
    doc.node(id).ok_or_else(|| Error::Script(format!("no object {id}")))
}
