////////////////////////////////////////////////////////////////////////////////
// Wobble: an effect of its own, which moves the points of paths along their
// normals, in waves. While this script runs, Effect › Scriptographer lists it:
// apply it to objects there, and change it in the Appearance panel. The app
// draws it with what this script drew, also once the script ended.

new Effect({
	type: 'wobble',
	label: 'Wobble',
	parameters: {
		amount: {
			label: 'Amount', type: 'number', range: [0, 100], units: 'point',
			value: 5
		},
		waves: {
			label: 'Waves', type: 'number', range: [1, 100], value: 8
		}
	},

	onApply: function(event) {
		var amount = this.amount,
			waves = Math.round(this.waves),
			result = event.art.clone({ insert: false });
		// Each path, as points along it, eight to a wave:
		(result.children || [result]).forEach(function(path) {
			var length = path.length,
				count = waves * 8,
				points = [];
			for (var i = 0; i < count + (path.closed ? 0 : 1); i++) {
				var offset = length * i / count;
				points.push(path.getPointAt(offset) + path.getNormalAt(offset)
						* amount * Math.sin(i / count * waves * 2 * Math.PI));
			}
			path.segments = points;
			path.smooth();
		});
		return result;
	}
});
