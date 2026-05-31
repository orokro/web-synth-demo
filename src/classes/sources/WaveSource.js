/*
	WaveSource.js
	-------------

	Abstract base for every kind of wave in a project (generated, custom,
	combined, shaped, gradient, sampled). The one thing they all share is the
	ability to produce a single normalized cycle of samples via a reactive
	`cycle` computed — that array is the universal currency the synth and the
	previews consume.

	State lives in vue refs on plain members so the same instance works inside
	and outside Vue and is easy to serialize. References between sources are by
	id, never by clone, so edits propagate.
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

		// reactive single cycle; subclasses implement generate()
		this.cycle = computed(() => this.generate());
	}


	/**
	 * Produces one normalized cycle of samples. Subclasses override this; the
	 * base returns silence.
	 *
	 * @returns {Float32Array} length CYCLE_RESOLUTION, values in [-1, 1]
	 */
	generate() {
		return new Float32Array(CYCLE_RESOLUTION);
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
	 * Serializes the common fields. Subclasses extend this.
	 *
	 * @returns {Object}
	 */
	toJSON() {
		return { id: this.id, name: this.name.value, type: this.type };
	}

}
