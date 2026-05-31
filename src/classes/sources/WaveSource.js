/*
	WaveSource.js
	-------------

	Abstract base for every kind of wave in a project (generated, custom,
	combined, shaped, gradient, sampled). They all share one thing: the ability
	to produce a single normalized cycle of samples via a reactive `cycle`
	computed — that array is the universal currency the synth and previews use.

	Sources that reference other sources (combined, later gradient/shaped) read
	them through `resolve(id)`, a lookup the Project injects, and declare their
	references via getDependencies() so the Project can prevent reference cycles.
	References are by id, never clone, so edits propagate.
*/

// vue
import { ref, computed } from "vue";

// samples per cycle; power of two for the FFT path
export const CYCLE_RESOLUTION = 2048;

/**
 * Generates a reasonably unique id.
 *
 * @returns {String}
 */
function makeId() {
	if (typeof crypto !== "undefined" && crypto.randomUUID)
		return crypto.randomUUID();
	return `src-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// main export
export default class WaveSource {

	/**
	 * @param {Object} opts
	 * @param {String} [opts.id] - existing id (e.g. when deserializing)
	 * @param {String} [opts.name] - display name
	 * @param {String} opts.type - source kind slug
	 */
	constructor({ id, name, type }) {

		this.id = id ?? makeId();
		this.type = type;
		this.name = ref(name ?? "Untitled");

		// id -> WaveSource lookup, injected by the Project; null when standalone
		this.resolve = null;

		// reactive single cycle; subclasses implement generate()
		this.cycle = computed(() => this.generate());
	}


	/**
	 * Produces one normalized cycle of samples. Subclasses override; the base
	 * returns silence.
	 *
	 * @returns {Float32Array} length CYCLE_RESOLUTION, values in [-1, 1]
	 */
	generate(n = CYCLE_RESOLUTION) {
		return new Float32Array(n);
	}


	/**
	 * Returns the current cycle (reactive read).
	 *
	 * @returns {Float32Array}
	 */
	getCycle() {
		return this.cycle.value;
	}


	/**
	 * Renders the wave at an arbitrary resolution (for sampler-mode buffers).
	 * Not cached — call once per render; getCycle() stays the cached 2048-sample
	 * version used by the oscillator, previews and graph wiring.
	 *
	 * @param {Number} n - sample count
	 * @returns {Float32Array}
	 */
	render(n) {
		return this.generate(n);
	}


	/**
	 * Samples a child source at resolution n: the cached cycle at the default
	 * resolution (reactive), else a fresh high-res render.
	 *
	 * @param {WaveSource} src - child source
	 * @param {Number} n - sample count
	 * @returns {Float32Array}
	 */
	childSamples(src, n) {
		return n === CYCLE_RESOLUTION ? src.getCycle() : src.render(n);
	}


	/**
	 * Ids of other sources this one references. Empty for leaf sources;
	 * overridden by combining/morphing types so the Project can detect cycles.
	 *
	 * @returns {Array<String>}
	 */
	getDependencies() {
		return [];
	}


	/**
	 * Serializes the common fields. Subclasses extend this.
	 *
	 * @returns {Object}
	 */
	toJSON() {
		return { id: this.id, name: this.name.value, type: this.type };
	}

}
