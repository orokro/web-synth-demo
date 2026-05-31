/*
	SampledWave.js
	--------------

	A wave sourced from an imported audio file. The decoded audio is mixed to
	mono and stored; trim bounds (normalized 0..1 of the file) select the used
	region. As a "wave" it behaves like any other: generate(n) resamples the
	trimmed region to n samples, so it can feed combiners/shapers/gradients and
	be played in either synth engine. In Sampler mode at its natural base length
	it plays back like the original recording.

	It is a "timed" source — it has a natural duration in seconds — so the synth
	can adopt that as its sampler base length ("Set base length").

	The audio persists in the project as base64 Int16 (capped in length to keep
	localStorage bounded); fidelity is fine for the demo.
*/

// base
import WaveSource, { CYCLE_RESOLUTION } from "./WaveSource.js";

// vue
import { ref } from "vue";

// cap stored/decoded mono length (seconds) to bound memory + localStorage
const MAX_STORE_SECONDS = 8;

/**
 * Clamp to [0,1].
 *
 * @param {Number} v - value
 * @returns {Number}
 */
function clamp01(v) {
	return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * Encodes a byte array to base64 (chunked to avoid call-stack limits).
 *
 * @param {Uint8Array} bytes - bytes
 * @returns {String}
 */
function bytesToBase64(bytes) {
	let bin = "";
	const chunk = 0x8000;
	for (let i = 0; i < bytes.length; i += chunk)
		bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
	return btoa(bin);
}

/**
 * Decodes base64 to a byte array.
 *
 * @param {String} b64 - base64
 * @returns {Uint8Array}
 */
function base64ToBytes(b64) {
	const bin = atob(b64);
	const out = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++)
		out[i] = bin.charCodeAt(i);
	return out;
}

/**
 * Float32 mono [-1,1] -> base64 of Int16.
 *
 * @param {Float32Array} mono - samples
 * @returns {String}
 */
function encodeMono(mono) {
	const i16 = new Int16Array(mono.length);
	for (let i = 0; i < mono.length; i++) {
		let v = mono[i];
		v = v < -1 ? -1 : v > 1 ? 1 : v;
		i16[i] = Math.round(v * 32767);
	}
	return bytesToBase64(new Uint8Array(i16.buffer));
}

/**
 * base64 of Int16 -> Float32 mono.
 *
 * @param {String} b64 - base64
 * @returns {Float32Array}
 */
function decodeMono(b64) {
	if (!b64)
		return new Float32Array(0);
	const bytes = base64ToBytes(b64);
	const i16 = new Int16Array(bytes.buffer, 0, Math.floor(bytes.length / 2));
	const out = new Float32Array(i16.length);
	for (let i = 0; i < i16.length; i++)
		out[i] = i16[i] / 32767;
	return out;
}

// main export
export default class SampledWave extends WaveSource {

	/**
	 * @param {Object} [opts]
	 * @param {String} [opts.id]
	 * @param {String} [opts.name="Sample"]
	 * @param {String} [opts.fileName]
	 * @param {Number} [opts.sampleRate=44100]
	 * @param {Number} [opts.trimStart=0]
	 * @param {Number} [opts.trimEnd=1]
	 * @param {String} [opts.audio] - base64 Int16 mono (from toJSON)
	 * @param {Float32Array} [opts.mono] - decoded mono (in-app import)
	 */
	constructor(opts = {}) {

		super({ id: opts.id, name: opts.name ?? "Sample", type: "sampled" });

		this.fileName = ref(opts.fileName ?? "");
		this.sampleRate = opts.sampleRate ?? 44100;
		this.trimStart = ref(clamp01(opts.trimStart ?? 0));
		this.trimEnd = ref(clamp01(opts.trimEnd ?? 1));

		// decoded mono (plain, not a ref); version bumps to invalidate the cycle
		this.mono = opts.mono instanceof Float32Array ? opts.mono : decodeMono(opts.audio);
		this.version = ref(0);
	}


	/**
	 * Replaces the audio with freshly decoded mono (capped in length).
	 *
	 * @param {Float32Array} mono - decoded mono samples
	 * @param {Number} sampleRate - sample rate (Hz)
	 * @param {String} fileName - source file name
	 * @returns {void}
	 */
	setAudio(mono, sampleRate, fileName) {
		const cap = Math.floor(MAX_STORE_SECONDS * sampleRate);
		this.mono = mono.length > cap ? mono.slice(0, cap) : mono;
		this.sampleRate = sampleRate;
		this.fileName.value = fileName || "";
		this.trimStart.value = 0;
		this.trimEnd.value = 1;
		this.version.value++;
	}


	/**
	 * Trimmed region length in samples.
	 *
	 * @returns {Number}
	 */
	trimmedLength() {
		const a = Math.floor(this.trimStart.value * this.mono.length);
		const b = Math.floor(this.trimEnd.value * this.mono.length);
		return Math.max(0, b - a);
	}


	/**
	 * Natural (trimmed) duration in seconds.
	 *
	 * @returns {Number}
	 */
	naturalDuration() {
		return this.sampleRate > 0 ? this.trimmedLength() / this.sampleRate : 0;
	}


	/**
	 * Resamples the trimmed region to n samples (linear interpolation).
	 *
	 * @returns {Float32Array}
	 */
	generate(n = CYCLE_RESOLUTION) {

		// touch reactive deps so trim edits / new imports re-render
		const v = this.version.value;
		const ts = this.trimStart.value;
		const te = this.trimEnd.value;
		void v;

		const out = new Float32Array(n);
		const mono = this.mono;
		if (!mono || mono.length < 2)
			return out;

		const s0 = Math.floor(clamp01(Math.min(ts, te)) * mono.length);
		const s1 = Math.floor(clamp01(Math.max(ts, te)) * mono.length);
		const len = s1 - s0;
		if (len < 2)
			return out;

		for (let i = 0; i < n; i++) {
			const src = s0 + (i / n) * len;
			const k = Math.floor(src);
			const frac = src - k;
			const a = mono[Math.min(k, s1 - 1)];
			const b = mono[Math.min(k + 1, s1 - 1)];
			out[i] = a + (b - a) * frac;
		}
		return out;
	}


	/**
	 * @returns {Object}
	 */
	toJSON() {
		return {
			...super.toJSON(),
			fileName: this.fileName.value,
			sampleRate: this.sampleRate,
			trimStart: this.trimStart.value,
			trimEnd: this.trimEnd.value,
			audio: encodeMono(this.mono)
		};
	}


	/**
	 * @param {Object} data - output of toJSON()
	 * @returns {SampledWave}
	 */
	static fromJSON(data) {
		return new SampledWave(data);
	}

}
