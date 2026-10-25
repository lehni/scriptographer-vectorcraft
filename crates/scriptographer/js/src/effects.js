import { natives } from './natives.js'

// The effects scripts define, `new Effect({ type, label, parameters, onApply
// })`, which the app lists in Effect › Scriptographer while the script runs, and
// draws with what the script drew of them: the runtime calls `applyEffect()`
// once an object's input to one changed.

// Watches the effects that register from now on, after the app's own:
export function watchEffects(Effect) {
  const { add, remove } = Effect
  Effect.add = function (effect) {
    natives.effects.define(
      effect.type,
      effect.label,
      JSON.stringify(effect.parameters)
    )
    return add.call(this, effect)
  }
  Effect.remove = function (effect) {
    const removed = remove.call(this, effect)
    if (removed) natives.effects.forget(effect.type)
    return removed
  }
}

// What the effect of `type` with `parameters` makes of `art`, Paper.js JSON of
// the input with the object's style, for the item of `key`, as JSON. An effect
// draws, and changes nothing: what `onApply()` makes goes into no project, and
// its `event.item` is a copy of the object.
export function applyEffect(scope, type, parameters, art, key) {
  const { Effect, EffectInstance, Base, project, settings } = scope
  const { insertItems } = settings
  settings.insertItems = false
  try {
    const effect = Effect.get(type)
    const input = Base.importJSON(art)
    const instance = new EffectInstance({ type, parameters })
    const item = project.getItemByKey(key)?.clone()
    const output = (
      effect?.onApply?.call(instance, { art: input, item }) ??
      input
    )
    return output.exportJSON()
  } finally {
    settings.insertItems = insertItems
  }
}
