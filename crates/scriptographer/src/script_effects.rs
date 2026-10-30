//! The effects scripts define (`new Effect({ type, label, parameters, onApply })`, core's `src/effects.js`),
//! which the app lists in Effect › Scriptographer while their script runs
//! ([`vectorcraft_effects::script`]), with the parameters their Palette components describe. The
//! app never runs a script to draw one: once the script's work is done, it draws those of its
//! effects whose input changed and keeps what it drew in them ([`Runtime::effect_outputs`]), which
//! the app adds to the newest undo step, as the edit that changed their input.

use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};

use serde_json::{Map, Value as Json, json};
use vectorcraft_doc::{Appearance, Document, Node};
use vectorcraft_effects::script::{self, INPUT, OUTPUT};
use vectorcraft_geom::PathData;
use vectorcraft_plugins::Manifest;

use crate::{Call, Engine, Error, HostFunction, Runtime, Scope, Value, call_bundle};

/// What a runtime keeps of the effects its scripts define: the runtime's number, which owns them in
/// the app's list, their types, the document it last drew them for, and the inputs they failed to
/// draw, which it doesn't try again.
pub(crate) struct Defined {
    owner: u64,
    pub(crate) types: Vec<String>,
    drawn: Option<Arc<Document>>,
    failed: Vec<String>,
}

impl Default for Defined {
    fn default() -> Self {
        static NEXT_OWNER: AtomicU64 = AtomicU64::new(1);
        Self { owner: NEXT_OWNER.fetch_add(1, Ordering::Relaxed), types: Vec::new(), drawn: None, failed: Vec::new() }
    }
}

/// The natives core's `src/effects.js` talks through: `define(type, label, parameters)`, the
/// parameters as JSON, and `forget(type)`.
pub(crate) fn natives<E: Engine>(engine: &mut E) -> Result<Vec<(&'static str, E::Handle)>, Error> {
    let natives: [(&str, HostFunction<E::Handle>); 2] = [("define", define), ("forget", forget)];
    natives.into_iter().map(|(name, f)| Ok((name, engine.function(name, f)?))).collect()
}

/// `define(type, label, parameters)`: lists the effect in Effect › Scriptographer, in place of one
/// of the same type.
fn define<H: Clone>(call: &mut dyn Call<H>, _this: &Value<H>, args: &[Value<H>]) -> Result<Value<H>, Error> {
    let text = |call: &mut dyn Call<H>, i: usize| call.to_string(args.get(i).unwrap_or(&Value::Undefined));
    let (kind, label, parameters) = (text(call, 0)?, text(call, 1)?, text(call, 2)?);
    let parameters: Json = serde_json::from_str(&parameters).unwrap_or(Json::Null);
    let manifest = manifest(&kind, &label, &parameters)?;
    let host = call.host()?;
    let mut host = host.borrow_mut();
    let defined = &mut host.script_effects;
    script::register(defined.owner, manifest);
    defined.types.retain(|t| *t != kind);
    defined.types.push(kind);
    // Its objects draw anew with the effect as it is now:
    defined.drawn = None;
    defined.failed.clear();
    Ok(Value::Undefined)
}

/// `forget(type)`: the effect is no longer listed.
fn forget<H>(call: &mut dyn Call<H>, _this: &Value<H>, args: &[Value<H>]) -> Result<Value<H>, Error> {
    let kind = call.to_string(args.first().unwrap_or(&Value::Undefined))?;
    let host = call.host()?;
    let defined = &mut host.borrow_mut().script_effects;
    script::unregister(defined.owner, &kind);
    defined.types.retain(|t| *t != kind);
    Ok(Value::Undefined)
}

/// Lets go of the effects a runtime's scripts defined, once it ends.
pub(crate) fn forget_all(defined: &Defined) {
    for kind in &defined.types {
        script::unregister(defined.owner, kind);
    }
}

/// The manifest of the effect `kind`, its parameters as the Palette components that describe them
/// (`number`, `slider`, `boolean`, `list` of texts, `string`); others, which effect dialogs don't
/// show, are left out.
fn manifest(kind: &str, label: &str, parameters: &Json) -> Result<Manifest, Error> {
    if kind.contains('.') {
        return Err(Error::Type(format!("Invalid effect type: '{kind}', which can't have a dot.")));
    }
    let params: Map<String, Json> =
        parameters.as_object().into_iter().flatten().filter_map(|(key, component)| Some((key.clone(), param(component)?))).collect();
    let json = json!({ "id": kind, "name": label, "kind": "effect", "params": params });
    Manifest::parse(json.to_string().as_bytes()).map_err(|e| Error::Type(format!("Invalid effect: {e}")))
}

/// A manifest's parameter for the Palette component `c`.
fn param(c: &Json) -> Option<Json> {
    let value = &c["value"];
    let bound = |key: &str, at: usize, or: f64| c[key].as_f64().or(c["range"][at].as_f64()).filter(|n| n.is_finite()).unwrap_or(or);
    let mut param = match c["type"].as_str().unwrap_or("number") {
        kind @ ("number" | "slider" | "range") => {
            let slider = kind != "number";
            let (min, max) = (bound("min", 0, if slider { 0.0 } else { -1e6 }), bound("max", 1, if slider { 1.0 } else { 1e6 }));
            json!({ "type": "number", "min": min, "max": max.max(min), "default": value.as_f64().unwrap_or(min.max(0.0).min(max)) })
        }
        "boolean" | "checkbox" => json!({ "type": "bool", "default": value.as_bool().unwrap_or(false) }),
        "list" => {
            let options: Vec<&str> = c["options"].as_array()?.iter().map(Json::as_str).collect::<Option<_>>()?;
            json!({ "type": "choice", "options": options, "default": value.as_str().or(options.first().copied()) })
        }
        "string" => json!({ "type": "string", "default": value.as_str().unwrap_or_default() }),
        _ => return None,
    };
    if let Some(label) = c["label"].as_str() {
        param["label"] = json!(label);
    }
    // Scriptographer's length units, as the effect dialogs name them:
    if let Some(units) = c["units"].as_str() {
        param["unit"] = json!(match units {
            "point" => "pt",
            "millimeter" => "mm",
            "centimeter" => "cm",
            "inch" => "in",
            "pixel" => "px",
            other => other,
        });
    }
    Some(param)
}

impl<E: Engine> Runtime<E> {
    /// What the effects the scripts define draw of the objects whose input changed since they last
    /// drew them, as `document.patch` params that replace those objects, with what each effect drew
    /// kept in it; `None` when nothing changed. An effect that fails to draw says why in the
    /// script's output, and stays as it was until its input changes again.
    pub fn effect_outputs(&mut self, scope: &Scope<E::Handle>) -> Result<Option<Json>, Error> {
        let (types, doc) = {
            let mut host = self.host.borrow_mut();
            let Some(doc) = host.binding.active().map(|b| b.doc.clone()) else {
                return Ok(None);
            };
            let defined = &mut host.script_effects;
            if defined.types.is_empty() || defined.drawn.as_ref().is_some_and(|d| Arc::ptr_eq(d, &doc)) {
                return Ok(None);
            }
            defined.drawn = Some(doc.clone());
            (defined.types.clone(), doc)
        };
        let ours = |id: &str| script::script_type(id).is_some_and(|kind| types.iter().any(|t| t == kind));
        let mut objects = Vec::new();
        doc.walk(|n| {
            if n.appearance.effects.iter().any(|e| ours(&e.id)) {
                objects.push(n.clone());
            }
        });
        let mut replace = Vec::new();
        for mut node in objects {
            let mut changed = false;
            // One at a time, as each one's input is what the effects before it drew:
            while let Some(input) = script::inputs(&node).into_iter().find(|input| {
                let failed = self.host.borrow().script_effects.failed.contains(&input.fingerprint);
                node.appearance.effects.get(input.index).is_some_and(|e| ours(&e.id) && e.params[INPUT] != json!(input.fingerprint)) && !failed
            }) {
                let Some(effect) = node.appearance.effects.get(input.index).cloned() else {
                    break;
                };
                match self.draw_effect(scope, &node, &effect, &input.path) {
                    Ok(output) => {
                        let mut appearance = (*node.appearance).clone();
                        if let Some(effect) = appearance.effects.get_mut(input.index) {
                            // A file may leave an effect's parameters out: what it drew needs a place.
                            if !effect.params.is_object() {
                                effect.params = json!({});
                            }
                            if let Some(params) = effect.params.as_object_mut() {
                                params.insert(INPUT.into(), json!(input.fingerprint));
                                params.insert(OUTPUT.into(), serde_json::to_value(&output).unwrap_or_default());
                            }
                        }
                        node.appearance = appearance.into();
                        changed = true;
                    }
                    Err(e) => {
                        let mut host = self.host.borrow_mut();
                        host.print(format!("Uncaught {e}"));
                        host.script_effects.failed.push(input.fingerprint);
                    }
                }
            }
            if changed {
                replace.push(serde_json::to_value(&node).map_err(|e| Error::Script(format!("writing an object: {e}")))?);
            }
        }
        Ok((!replace.is_empty()).then(|| json!({ "replace": replace })))
    }

    /// What the script's `effect` draws of `path`, the input of the effect on `node`: its
    /// `onApply()` gets `path` as art with the object's style, and the object's item.
    fn draw_effect(&mut self, scope: &Scope<E::Handle>, node: &Node, effect: &vectorcraft_doc::Effect, path: &PathData) -> Result<PathData, Error> {
        let appearance = Appearance { effects: Vec::new(), ..(*node.appearance).clone() };
        let art =
            crate::host::tree_json(&Node::path(node.id, path.clone(), appearance)).ok_or_else(|| Error::Script("no art for the effect".into()))?;
        let kind = script::script_type(&effect.id).unwrap_or_default().to_owned();
        let parameters = crate::effects::effect_json(&vectorcraft_doc::Effect {
            params: vectorcraft_effects::merged_params(&effect.id, &effect.params),
            ..effect.clone()
        })["parameters"]
            .clone();
        let output = self.engine.with_call(|call| {
            let parameters = crate::binding::js_value(call, &parameters)?;
            let args = [Value::Js(scope.0.clone()), Value::String(kind), parameters, Value::String(art.to_string()), Value::Number(node.id.0 as f64)];
            call_bundle(call, "applyEffect", &args)
        })?;
        let Value::String(output) = output else {
            return Err(Error::Script("the effect drew nothing".into()));
        };
        let output: Json = serde_json::from_str(&output).map_err(|e| Error::Script(format!("the effect's art: {e}")))?;
        shape(&output)
    }
}

/// The geometry of an effect's art: a path's, a compound path's, or that of the paths in a group.
fn shape(json: &Json) -> Result<PathData, Error> {
    match json.get(0).and_then(Json::as_str) {
        Some("Path" | "CompoundPath") => crate::writeback::path_data(json, None),
        Some("Group") => {
            let children = json.get(1).and_then(|props| props.get("children")).and_then(Json::as_array).cloned().unwrap_or_default();
            let mut path = PathData::new(Vec::new());
            for child in &children {
                path.subpaths.extend(shape(child)?.subpaths);
            }
            Ok(path)
        }
        _ => Err(Error::Type("an effect's onApply() gives a path, a compound path or a group of them".into())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The parameters are the Palette components dialogs can show, as an effect plug-in declares
    /// them.
    #[test]
    fn a_script_effects_manifest_follows_its_components() {
        let components = json!({
            "amount": { "label": "Amount", "type": "number", "range": [0, 100], "units": "point", "value": 5 },
            "even": { "type": "boolean", "value": true },
            "style": { "type": "list", "options": ["a", "b"], "value": "b" },
            "note": { "type": "string" },
            "tint": { "type": "color", "value": "#ff0000" }
        });
        let manifest = manifest("wobble", "Wobble", &components).unwrap();
        assert_eq!((manifest.id.as_str(), manifest.name.as_str()), ("wobble", "Wobble"));
        let params = serde_json::to_value(&manifest).unwrap()["params"].clone();
        assert_eq!(params["amount"], json!({ "type": "number", "min": 0.0, "max": 100.0, "default": 5.0, "label": "Amount", "unit": "pt" }));
        assert_eq!((&params["even"]["default"], &params["style"]["default"], &params["note"]["type"]), (&json!(true), &json!("b"), &json!("string")));
        assert!(params.get("tint").is_none(), "a color isn't an effect parameter");
        assert!(super::manifest("my.wobble", "Wobble", &json!({})).is_err(), "a type with a dot would be an app effect's");
    }
}
