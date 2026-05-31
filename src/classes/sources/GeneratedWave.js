/*
	GeneratedWave.js
	----------------

	A built-in oscillator shape (sine, square, sawtooth, triangle, pulse) with
	simple parameters. Produces its cycle analytically; the synth then FFTs that
	cycle into a PeriodicWave, so even these stock shapes ride the same band-
	limited path as custom waves.
*/

// base
import WaveSource, { CYCLE_RESOLUTION } from "./WaveSource.js";

// vue
import { ref } from "vue";

// supported waveform names
export const WAVEFORMS = ["sine", "square", "sawtooth", "triangle", "pulse"];

// main export
export default class GeneratedWave extends WaveSource {

	/**
	 * @param {Object} [opts]
	 * @param {String} [opts.id]
	 * @param {String} [opts.name="Generated"]
	 * @param {String} [opts.waveform="sine"]
	 * @param {Number} [opts.pulseWidth=0.5] - duty cycle for the pulse waveform (0-1)
	 */
	constructor(opts = {}) {

		super({ id: opts.id, name: opts.name ?? "Generated", type: "generated" });

		this.waveform = ref(opts.waveform ?? "sine");
		this.pulseWidth = ref(opts.pulseWidth ?? 0.5);
	}


	/**
	 * Builds one cycle of the selected waveform.
	 *
	 * @returns {Float32Array}
	 */
	generate(n = CYCLE_RESOLUTION) {

		const out = new Float32Array(n);
		const waveform = this.waveform.value;
		const pulseWidth = this.pulseWidth.value;

		for (let i = 0; i < n; i++) {

			const t = i / n;
			let value;

			switch (waveform) {
				case "square":
					value = t < 0.5 ? 1 : -1;
					break;
				case "pulse":
					value = t < pulseWidth ? 1 : -1;
					break;
				case "sawtooth":
					value = 2 * t - 1;
					break;
				case "triangle":
					value = 4 * Math.abs(t - 0.5) - 1;
					break;
				case "sine":
				default:
					value = Math.sin(2 * Math.PI * t);
			}

			out[i] = value;
		}

		return out;
	}


	/**
	 * @returns {Object}
	 */
	toJSON() {
		return {
			...super.toJSON(),
			waveform: this.waveform.value,
			pulseWidth: this.pulseWidth.value
		};
	}


	/**
	 * Rebuilds a GeneratedWave from serialized data.
	 *
	 * @param {Object} data - output of toJSON()
	 * @returns {GeneratedWave}
	 */
	static fromJSON(data) {
		return new GeneratedWave(data);
	}

}
