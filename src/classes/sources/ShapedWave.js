/*
	ShapedWave.js
	-------------

	Sculpts a wave by booleaning vector shapes against a base. The base is an
	optional referenced source repeated `frequency` times (like the combiner), or
	a flat line at the bottom when there's no input. Each shape is a unit
	primitive mapped into a free quad and either adds to or carves the base.

	Audio model (scanline height-field): the playable wave is the single-valued
	top edge, so we keep a per-column height and apply shapes in order —
	add raises the top to the shape's top; subtract (clip) carves the top down to
	the shape's lower edge where the shape cuts in. Shapes fully below the top
	make inaudible holes and are ignored. (scale-to-fit subtract is a later mode.)
*/

// base
import WaveSource, { CYCLE_RESOLUTION } from "./WaveSource.js";

// vue
import { shallowRef, ref } from "vue";

// geometry
import { transformedPolygon, columnSpans, defaultQuad } from "../shapeGeom.js";

// shape modes
export const SHAPE_MODES = ["add", "subtract"];

// shape types
export const SHAPE_TYPES = ["square", "circle", "triangle"];

/**
 * Reasonably-unique id.
 *
 * @returns {String}
 */
function shapeId() {
	if (typeof crypto !== "undefined" && crypto.randomUUID)
		return crypto.randomUUID();
	return `shape-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Normalizes a shape descriptor with defaults.
 *
 * @param {Object} s - partial shape
 * @returns {Object}
 */
function normShape(s) {
	return {
		id: s.id ?? shapeId(),
		type: SHAPE_TYPES.includes(s.type) ? s.type : "square",
		mode: SHAPE_MODES.includes(s.mode) ? s.mode : "add",
		quad: Array.isArray(s.quad) && s.quad.length === 4 ? s.quad.map((c) => ({ x: c.x, y: c.y })) : defaultQuad()
	};
}

// main export
export default class ShapedWave extends WaveSource {

	/**
	 * @param {Object} [opts]
	 * @param {String} [opts.id]
	 * @param {String} [opts.name="Shaped"]
	 * @param {Object|null} [opts.input] - { sourceId, frequency } or null (flat base)
	 * @param {Array<Object>} [opts.shapes] - shape descriptors
	 */
	constructor(opts = {}) {
		super({ id: opts.id, name: opts.name ?? "Shaped", type: "shaped" });
		this.input = ref(opts.input ? { sourceId: opts.input.sourceId, frequency: opts.input.frequency ?? 1 } : null);
		this.shapes = shallowRef((opts.shapes || []).map(normShape));
	}


	/** @returns {Object|null} */
	getInput() {
		return this.input.value;
	}


	/**
	 * Sets (or clears) the base input.
	 *
	 * @param {Object|null} input - { sourceId, frequency } or null
	 * @returns {void}
	 */
	setInput(input) {
		this.input.value = input ? { sourceId: input.sourceId, frequency: input.frequency ?? 1 } : null;
	}


	/** @returns {Array<Object>} */
	getShapes() {
		return this.shapes.value;
	}


	/**
	 * Replaces the shape list.
	 *
	 * @param {Array<Object>} shapes - new shapes
	 * @returns {void}
	 */
	setShapes(shapes) {
		this.shapes.value = shapes.map(normShape);
	}


	/** @returns {Array<String>} referenced source ids */
	getDependencies() {
		return this.input.value ? [this.input.value.sourceId] : [];
	}


	/**
	 * Sculpts the wave: base height field, then each shape adds/carves the top.
	 *
	 * @returns {Float32Array}
	 */
	generate(n = CYCLE_RESOLUTION) {

		const h = new Float64Array(n);

		// base height field
		const input = this.input.value;
		const src = input && this.resolve ? this.resolve(input.sourceId) : null;
		if (src) {
			const cyc = this.childSamples(src, n);
			const freq = input.frequency || 1;
			for (let i = 0; i < n; i++) {
				let phase = (i / n) * freq % 1;
				if (phase < 0)
					phase += 1;
				const sp = phase * n;
				const k = Math.floor(sp);
				const frac = sp - k;
				h[i] = cyc[k % n] + (cyc[(k + 1) % n] - cyc[k % n]) * frac;
			}
		} else {
			h.fill(-1);
		}

		// apply shapes in order
		for (const shape of this.shapes.value) {
			const poly = transformedPolygon(shape.type, shape.quad);
			const { lo, hi } = columnSpans(poly, n);
			for (let i = 0; i < n; i++) {
				if (hi[i] === -Infinity)
					continue;
				if (shape.mode === "add") {
					if (hi[i] > h[i])
						h[i] = hi[i];
				} else if (h[i] <= hi[i] && h[i] > lo[i]) {
					// subtract (clip): top is inside the shape -> carve down to its bottom
					h[i] = lo[i];
				}
			}
		}

		const out = new Float32Array(n);
		for (let i = 0; i < n; i++) {
			const v = h[i];
			out[i] = v < -1 ? -1 : v > 1 ? 1 : v;
		}
		return out;
	}


	/** @returns {Object} */
	toJSON() {
		return {
			...super.toJSON(),
			input: this.input.value ? { ...this.input.value } : null,
			shapes: this.shapes.value.map((s) => ({ id: s.id, type: s.type, mode: s.mode, quad: s.quad.map((c) => ({ x: c.x, y: c.y })) }))
		};
	}


	/**
	 * @param {Object} data - output of toJSON()
	 * @returns {ShapedWave}
	 */
	static fromJSON(data) {
		return new ShapedWave(data);
	}

}
