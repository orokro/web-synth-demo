/*
	CombinedWave.js
	---------------

	Stacks/blends other sources into one wave. Each input references a source by
	id and carries its own frequency (how many times that source repeats across
	the cycle), scale (amplitude before blending) and blend mode. The first input
	is the base; later inputs blend onto the accumulator with their mode.

	Output handling: with normalize off, the result is hard-clipped to [-1, 1];
	with normalize on, if the peak exceeds 1 the whole curve is scaled down to
	fit (preserving shape), so you can stack freely without clipping.

	Inputs are references, so editing a referenced source updates this wave live.
	The Project prevents reference cycles before they are created.
*/

// base
import WaveSource, { CYCLE_RESOLUTION } from "./WaveSource.js";

// vue
import { shallowRef, ref } from "vue";

// supported blend modes (the first input ignores its mode and acts as the base)
export const BLEND_MODES = ["add", "subtract", "multiply", "divide", "max", "min"];

/**
 * Normalizes an input descriptor with defaults.
 *
 * @param {Object} input - partial input
 * @returns {{sourceId:String, frequency:Number, scale:Number, blendMode:String}}
 */
function normalizeInput(input) {
	return {
		sourceId: input.sourceId,
		frequency: input.frequency ?? 1,
		scale: input.scale ?? 1,
		blendMode: input.blendMode ?? "add"
	};
}

/**
 * Blends a sample into the accumulator per a mode.
 *
 * @param {Number} acc - accumulator sample
 * @param {Number} v - incoming sample
 * @param {String} mode - blend mode
 * @returns {Number}
 */
function blend(acc, v, mode) {
	switch (mode) {
		case "subtract": return acc - v;
		case "multiply": return acc * v;
		case "divide": return Math.abs(v) < 1e-6 ? acc : acc / v;
		case "max": return Math.max(acc, v);
		case "min": return Math.min(acc, v);
		case "add":
		default: return acc + v;
	}
}

// main export
export default class CombinedWave extends WaveSource {

	/**
	 * @param {Object} [opts]
	 * @param {String} [opts.id]
	 * @param {String} [opts.name="Combined"]
	 * @param {Array<Object>} [opts.inputs] - input descriptors
	 * @param {Boolean} [opts.normalize=false] - scale-to-fit instead of clipping
	 */
	constructor(opts = {}) {
		super({ id: opts.id, name: opts.name ?? "Combined", type: "combined" });
		this.inputs = shallowRef((opts.inputs || []).map(normalizeInput));
		this.normalize = ref(opts.normalize ?? false);
	}


	/**
	 * @returns {Array<Object>}
	 */
	getInputs() {
		return this.inputs.value;
	}


	/**
	 * Replaces the input list.
	 *
	 * @param {Array<Object>} inputs - new inputs
	 * @returns {void}
	 */
	setInputs(inputs) {
		this.inputs.value = inputs.map(normalizeInput);
	}


	/**
	 * Toggles scale-to-fit normalization.
	 *
	 * @param {Boolean} on - whether to normalize
	 * @returns {void}
	 */
	setNormalize(on) {
		this.normalize.value = !!on;
	}


	/**
	 * @returns {Array<String>} referenced source ids
	 */
	getDependencies() {
		return this.inputs.value.map((i) => i.sourceId);
	}


	/**
	 * Blends all inputs into one cycle. Reads each referenced source's cycle
	 * (tracked reactively) so edits upstream propagate here.
	 *
	 * @returns {Float32Array}
	 */
	generate() {

		const n = CYCLE_RESOLUTION;
		const out = new Float32Array(n);
		const inputs = this.inputs.value;
		if (!inputs.length || !this.resolve)
			return out;

		let started = false;

		for (const inp of inputs) {

			const src = this.resolve(inp.sourceId);
			if (!src)
				continue;

			const cyc = src.getCycle();
			const freq = inp.frequency || 1;
			const scale = inp.scale ?? 1;

			for (let i = 0; i < n; i++) {
				let phase = (i / n) * freq % 1;
				if (phase < 0)
					phase += 1;
				const sp = phase * n;
				const k = Math.floor(sp);
				const frac = sp - k;
				const a = cyc[k % n];
				const b = cyc[(k + 1) % n];
				const v = (a + (b - a) * frac) * scale;
				out[i] = started ? blend(out[i], v, inp.blendMode) : v;
			}

			started = true;
		}

		if (this.normalize.value) {
			// scale-to-fit: only attenuate if we overshoot, keeping the shape
			let peak = 0;
			for (let i = 0; i < n; i++) {
				const m = Math.abs(out[i]);
				if (m > peak)
					peak = m;
			}
			if (peak > 1) {
				const inv = 1 / peak;
				for (let i = 0; i < n; i++)
					out[i] *= inv;
			}
		} else {
			// hard clip
			for (let i = 0; i < n; i++) {
				const x = out[i];
				out[i] = x < -1 ? -1 : x > 1 ? 1 : x;
			}
		}

		return out;
	}


	/**
	 * @returns {Object}
	 */
	toJSON() {
		return {
			...super.toJSON(),
			inputs: this.inputs.value.map((i) => ({ ...i })),
			normalize: this.normalize.value
		};
	}


	/**
	 * @param {Object} data - output of toJSON()
	 * @returns {CombinedWave}
	 */
	static fromJSON(data) {
		return new CombinedWave(data);
	}

}
