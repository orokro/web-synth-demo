/*
	GradientWave.js
	---------------

	Morphs between source waves across one cycle. Like a colour gradient, but each
	stop references a source wave and sits at a position along 0..1 (= the cycle).
	For each output column x, the two bracketing stops are crossfaded: lerp between
	the left stop's wave and the right stop's wave, each sampled at phase x (scaled
	by that stop's frequency). Before the first / after the last stop it clamps to
	that stop. The result is a single static cycle on the cheap PeriodicWave path.

	(A temporal "scan over the note" version belongs in the synth voice, not here,
	so sources stay static and cheap to reuse.)

	Stops reference sources by id; the Project prevents reference cycles.
*/

// base
import WaveSource, { CYCLE_RESOLUTION } from "./WaveSource.js";

// vue
import { shallowRef } from "vue";

/**
 * Clamps to [0, 1].
 *
 * @param {Number} v - value
 * @returns {Number}
 */
function clamp01(v) {
	return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * Normalizes a stop with defaults.
 *
 * @param {Object} s - partial stop
 * @returns {{sourceId:String, position:Number, frequency:Number, enabled:Boolean}}
 */
function normStop(s) {
	return { sourceId: s.sourceId, position: clamp01(s.position ?? 0.5), frequency: s.frequency ?? 1, enabled: s.enabled ?? true };
}

// main export
export default class GradientWave extends WaveSource {

	/**
	 * @param {Object} [opts]
	 * @param {String} [opts.id]
	 * @param {String} [opts.name="Gradient"]
	 * @param {Array<Object>} [opts.stops] - stop descriptors
	 */
	constructor(opts = {}) {
		super({ id: opts.id, name: opts.name ?? "Gradient", type: "gradient" });
		this.stops = shallowRef((opts.stops || []).map(normStop));
	}


	/** @returns {Array<Object>} */
	getStops() {
		return this.stops.value;
	}


	/**
	 * Replaces the stop list.
	 *
	 * @param {Array<Object>} stops - new stops
	 * @returns {void}
	 */
	setStops(stops) {
		this.stops.value = stops.map(normStop);
	}


	/** @returns {Array<String>} referenced source ids */
	getDependencies() {
		return this.stops.value.map((s) => s.sourceId);
	}


	/**
	 * Samples a stop's source cycle at phase x (scaled by the stop's frequency).
	 *
	 * @param {Object} stop - the stop
	 * @returns {Float32Array} one cycle for this stop
	 */
	sampleStop(stop, n) {
		const out = new Float32Array(n);
		const src = this.resolve ? this.resolve(stop.sourceId) : null;
		if (!src)
			return out;
		const cyc = this.childSamples(src, n);
		const freq = stop.frequency || 1;
		for (let i = 0; i < n; i++) {
			let phase = (i / n) * freq % 1;
			if (phase < 0)
				phase += 1;
			const sp = phase * n;
			const k = Math.floor(sp);
			out[i] = cyc[k % n] + (cyc[(k + 1) % n] - cyc[k % n]) * (sp - k);
		}
		return out;
	}


	/**
	 * Builds the morphed cycle by crossfading bracketing stops per column.
	 *
	 * @returns {Float32Array}
	 */
	generate(n = CYCLE_RESOLUTION) {

		const out = new Float32Array(n);
		// only enabled stops participate in the morph
		const stops = this.stops.value.filter((s) => s.enabled !== false);
		if (!stops.length)
			return out;

		const sorted = stops.slice().sort((a, b) => a.position - b.position);
		const samples = sorted.map((s) => this.sampleStop(s, n));

		if (sorted.length === 1) {
			for (let i = 0; i < n; i++) {
				const v = samples[0][i];
				out[i] = v < -1 ? -1 : v > 1 ? 1 : v;
			}
			return out;
		}

		const last = sorted.length - 1;
		for (let i = 0; i < n; i++) {
			const x = i / n;
			let v;
			if (x <= sorted[0].position) {
				v = samples[0][i];
			} else if (x >= sorted[last].position) {
				v = samples[last][i];
			} else {
				let s = 0;
				while (s < last && !(x >= sorted[s].position && x < sorted[s + 1].position))
					s++;
				const pL = sorted[s].position;
				const pR = sorted[s + 1].position;
				const t = pR > pL ? (x - pL) / (pR - pL) : 0;
				v = samples[s][i] + (samples[s + 1][i] - samples[s][i]) * t;
			}
			out[i] = v < -1 ? -1 : v > 1 ? 1 : v;
		}

		return out;
	}


	/** @returns {Object} */
	toJSON() {
		return {
			...super.toJSON(),
			stops: this.stops.value.map((s) => ({ ...s }))
		};
	}


	/**
	 * @param {Object} data - output of toJSON()
	 * @returns {GradientWave}
	 */
	static fromJSON(data) {
		return new GradientWave(data);
	}

}
