////////////////////////////////////////////////////////////////////////////////
// Live effects of the selected item: add Offset Path and Outline Stroke, change
// their parameters, hide them, reorder and remove them. The app draws them, and
// its Appearance panel lists them, next to the effects added there.

var names = {
	offset: 'Offset Path',
	outline: 'Outline Stroke'
};

var values = {
	type: 'Offset Path',
	effect: '',
	distance: 10,
	join: 'miter',
	miterLimit: 4,
	visible: true,
	bounds: ''
};

function getItem() {
	return project.selectedItems[0];
}

// The effect chosen in the palette, of the selected item:
function getEffect() {
	var item = getItem(),
		index = components.effect.options.indexOf(values.effect);
	return item && item.effects[index];
}

// Shows the selected item's effects, the parameters of the chosen one, and the
// item's bounds with and without its effects:
function update() {
	var item = getItem(),
		effects = item ? item.effects : [];
	components.effect.options = effects.map(function(effect, i) {
		return (i + 1) + '. ' + (names[effect.type] || effect.type);
	});
	if (components.effect.options.indexOf(values.effect) == -1)
		values.effect = components.effect.options[0] || '';
	var effect = getEffect(),
		isOffset = !!effect && effect.type == 'offset';
	if (isOffset) {
		values.distance = effect.distance;
		values.join = effect.join;
		values.miterLimit = effect.miterLimit;
	}
	if (effect)
		values.visible = effect.visible;
	components.distance.enabled = components.join.enabled
			= components.miterLimit.enabled = isOffset;
	['visible', 'up', 'down', 'remove'].forEach(function(name) {
		components[name].enabled = !!effect;
	});
	components.add.enabled = !!item;
	values.bounds = item
			? 'Bounds: ' + format(item.bounds)
				+ '\nPreview bounds: ' + format(item.previewBounds)
			: 'Select an object.';
}

function format(rect) {
	return [rect.x, rect.y, rect.width, rect.height].map(function(value) {
		return Math.round(value * 100) / 100;
	}).join(', ');
}

// Chooses the effect at the index in the palette:
function choose(index) {
	update();
	values.effect = components.effect.options[index];
	update();
}

// Sets a parameter of the chosen effect:
function setParameter(name) {
	return function(value) {
		var effect = getEffect();
		if (effect) {
			effect[name] = value;
			update();
		}
	};
}

// Moves the chosen effect by the amount in the order:
function move(amount) {
	var item = getItem(),
		effect = getEffect();
	if (effect) {
		var index = effect.index + amount;
		if (index >= 0 && index < item.effects.length) {
			effect.remove();
			item.insertEffect(index, effect);
			choose(index);
		}
	}
}

////////////////////////////////////////////////////////////////////////////////
// Interface

var components = {
	type: {
		label: 'Effect',
		options: [names.offset, names.outline]
	},
	add: {
		type: 'button', value: 'Add',
		onClick: function() {
			var item = getItem();
			if (item) {
				var type = values.type == names.offset ? 'offset' : 'outline';
				choose(item.addEffect({ type: type }).index);
			}
		}
	},
	ruler: { type: 'ruler' },
	effect: {
		label: 'Edit', options: [],
		onChange: update
	},
	distance: {
		label: 'Distance', type: 'number', units: 'point',
		onChange: setParameter('distance')
	},
	join: {
		label: 'Join', options: ['miter', 'round', 'bevel'],
		onChange: setParameter('join')
	},
	miterLimit: {
		label: 'Miter Limit', type: 'number',
		range: [1, 500],
		onChange: setParameter('miterLimit')
	},
	visible: {
		label: 'Visible', type: 'checkbox',
		onChange: setParameter('visible')
	},
	up: {
		type: 'button', value: 'Move Up',
		onClick: function() {
			move(-1);
		}
	},
	down: {
		type: 'button', value: 'Move Down',
		onClick: function() {
			move(1);
		}
	},
	remove: {
		type: 'button', value: 'Remove',
		onClick: function() {
			var effect = getEffect();
			if (effect) {
				effect.remove();
				update();
			}
		}
	},
	ruler2: { type: 'ruler' },
	bounds: { type: 'text' },
	refresh: {
		type: 'button', value: 'Read the Selection',
		onClick: update
	}
};

update();
var palette = new Palette('Live Effects', components, values);
