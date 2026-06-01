/*
	Envelope.js
	-----------

	The synth's amplitude envelope, built from up to three optional *stages* that
	each reference one of the project's existing sources (the same curves you make
	with the Custom / Combined / Shaped / Gradient / Sampled editors) plus a length
	in seconds. "wave == wave" extended to envelopes — the advanced wave tools also
	author envelope shapes.

		- attack:  played once on note-on over its length (the 0 -> sustain rise)
		- sustain: held while the key is down (v1 = flat hold at the attack's end
		           level; a looping sustain curve is a planned follow-up)
		- release: played once on note-off over its length, ending in silence

	A source outputs -1..1; it's mapped to a 0..1 level via (v+1)/2 (bottom of the
	curve = silent, top = full). A stage that's enabled but has no source behaves
	as a straight linear ramp over its length, which is the sensible default.

	The synth reads stage curves at note time via `resolve` (set by the App) and
	schedules them onto the voice gain. The release always starts from the voice's
	current level so there's no click whenever you let go.
*/

// vue
import { shallowRef } from "vue";

// stage sampling resolution
const SAMPLE_RES = 256;

// duration clamp (seconds)
const MIN_TIME = 0.005;
const MAX_TIME = 8;

/**
 * Clamps a value to a range.
 *
 * @param {Number} v - value
 * @param {Number} lo - min
 * @param {Number} hi - max
 * @returns {Number}
 */
function clamp(v, lo, hi) {
	return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Normalizes a stage descriptor with defaults.
 *
 * @param {Object} s - partial stage
 * @param {Boolean} enabledDefault - default enabled state
 * @param {Number} lengthDefault - default length (s)
 * @returns {{sourceId:(String|null), length:Number, enabled:Boolean}}
 */
function normStage(s, enabledDefault, lengthDefault) {
	s = s || {};
	return {
		sourceId: s.sourceId ?? null,
		length: clamp(s.length ?? lengthDefault, MIN_TIME, MAX_TIME),
		strength: clamp(s.strength ?? 1, 0, 1),
		enabled: s.enabled ?? enabledDefault
	};
}

// main export
export default class Envelope {

	/**
	 * @param {Object} [opts]
	 * @param {Object} [opts.attack] - { sourceId, length, enabled }
	 * @param {Object} [opts.sustain] - { sourceId, length, enabled }
	 * @param {Object} [opts.release] - { sourceId, length, enabled }
	 */
	constructor(opts = {}) {

		// each stage is a reactive descriptor; setStage replaces it
		this.attack = shallowRef(normStage(opts.attack, true, 0.02));
		this.sustain = shallowRef(normStage(opts.sustain, false, 0.5));
		this.release = shallowRef(normStage(opts.release, true, 0.2));

		// id -> source lookup, injected by the App (mirrors source.resolve)
		this.resolve = null;
	}


	/**
	 * The reactive descriptor for a stage name.
	 *
	 * @param {String} name - "attack" | "sustain" | "release"
	 * @returns {Object}
	 */
	stage(name) {
		return this[name] ? this[name].value : null;
	}


	/**
	 * Patches one stage (merging into its current descriptor).
	 *
	 * @param {String} name - stage name
	 * @param {Object} patch - fields to merge
	 * @returns {void}
	 */
	setStage(name, patch) {
		if (!this[name])
			return;
		const cur = this[name].value;
		this[name].value = normStage({ ...cur, ...patch }, cur.enabled, cur.length);
	}


	/**
	 * Samples a stage's source as a 0..1 level curve, or null if the stage is
	 * disabled or has no resolvable source.
	 *
	 * @param {String} name - stage name
	 * @param {Number} [n=SAMPLE_RES] - sample count
	 * @returns {Float32Array|null}
	 */
	stageCurve(name, n = SAMPLE_RES) {

		const st = this.stage(name);
		if (!st || !st.enabled || !st.sourceId || !this.resolve)
			return null;

		const src = this.resolve(st.sourceId);
		if (!src)
			return null;

		const raw = typeof src.render === "function" ? src.render(n) : src.getCycle();
		const c = new Float32Array(n);
		for (let i = 0; i < n; i++) {
			const v = (raw[i] + 1) / 2;
			c[i] = v < 0 ? 0 : v > 1 ? 1 : v;
		}

		// strength blends the curve toward the straight line between its endpoints
		// (endpoints preserved, so the hold level is unaffected); 0 = linear ramp
		const strength = clamp(st.strength ?? 1, 0, 1);
		if (strength >= 0.999 || n < 2)
			return c;

		const a0 = c[0];
		const a1 = c[n - 1];
		const out = new Float32Array(n);
		for (let i = 0; i < n; i++) {
			const line = a0 + (a1 - a0) * (i / (n - 1));
			const v = line + (c[i] - line) * strength;
			out[i] = v < 0 ? 0 : v > 1 ? 1 : v;
		}
		return out;
	}


	/**
	 * The held (sustain) level, 0..1: the attack curve's end value when the attack
	 * stage drives a source, else full level.
	 *
	 * @returns {Number}
	 */
	holdLevel() {
		const c = this.stageCurve("attack", SAMPLE_RES);
		if (c)
			return c[c.length - 1];
		return 1;
	}


	/** @returns {Object} */
	toJSON() {
		return {
			attack: { ...this.attack.value },
			sustain: { ...this.sustain.value },
			release: { ...this.release.value }
		};
	}


	/**
	 * Restores from serialized data, mutating this instance (so the synth's
	 * reference stays valid).
	 *
	 * @param {Object} data - output of toJSON()
	 * @returns {void}
	 */
	loadJSON(data) {
		if (!data)
			return;
		if (data.attack)
			this.attack.value = normStage(data.attack, true, 0.02);
		if (data.sustain)
			this.sustain.value = normStage(data.sustain, false, 0.5);
		if (data.release)
			this.release.value = normStage(data.release, true, 0.2);
	}

}
