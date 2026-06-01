/*
	Envelope.js
	-----------

	The synth's amplitude envelope, drawn as a bezier curve rather than fixed
	ADSR knobs. The curve lives in [0,1] x [0,1] (x = progress, y = level) and is
	sampled as an upper silhouette (single-valued), exactly like CustomWave, so
	the drawn shape and the applied gain match.

	A vertical "split" at x = split marks the sustain point:
	  - the segment left of the split is the attack/decay shape, traversed once
	    over `attackTime` seconds when a note starts;
	  - the level at the split is the sustain level, held flat while the key is
	    down (for any duration);
	  - the segment right of the split is the release shape, traversed over
	    `releaseTime` seconds when the key is let go.

	The curve only defines shape; the two duration refs define speed. The synth
	feeds the sampled segments to a GainNode via setValueCurveAtTime.
*/

// vue
import { shallowRef, ref } from "vue";

// how finely the curve is sampled for playback + readouts
const SAMPLE_RES = 256;

// flattening steps per bezier segment
const FLATTEN_STEPS = 48;

// clamp duration knobs to a sane range (seconds)
const MIN_TIME = 0.001;
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
 * Makes a default anchor with zero-length handles.
 *
 * @param {Number} x - normalized x (0-1)
 * @param {Number} y - normalized y (0-1)
 * @returns {Object}
 */
function makeAnchor(x, y) {
	return { x, y, handleInX: 0, handleInY: 0, handleOutX: 0, handleOutY: 0, isBroken: false };
}

/**
 * Builds the default attack/decay -> sustain -> release shape (linear).
 *
 * @returns {Array<Object>}
 */
function defaultAnchors() {
	return [
		makeAnchor(0, 0),
		makeAnchor(0.16, 1),
		makeAnchor(0.4, 0.6),
		makeAnchor(1, 0)
	];
}

// main export
export default class Envelope {

	/**
	 * @param {Object} [opts]
	 * @param {Array<Object>} [opts.anchors] - curve anchors (0..1 space)
	 * @param {Number} [opts.split=0.4] - sustain x position
	 * @param {Number} [opts.attackTime=0.15] - pre-sustain duration (s)
	 * @param {Number} [opts.releaseTime=0.3] - release duration (s)
	 */
	constructor(opts = {}) {

		const anchors = Array.isArray(opts.anchors) && opts.anchors.length >= 2
			? opts.anchors.map((a) => ({ ...makeAnchor(a.x, a.y), ...a }))
			: defaultAnchors();

		anchors[0].x = 0;
		anchors[anchors.length - 1].x = 1;

		this.anchors = shallowRef(anchors);
		this.split = ref(clamp(opts.split ?? 0.4, 0, 1));
		this.attackTime = ref(clamp(opts.attackTime ?? 0.15, MIN_TIME, MAX_TIME));
		this.releaseTime = ref(clamp(opts.releaseTime ?? 0.3, MIN_TIME, MAX_TIME));
	}


	/** @returns {Array<Object>} */
	getAnchors() {
		return this.anchors.value;
	}


	/**
	 * Replaces the anchor list (used by the editor).
	 *
	 * @param {Array<Object>} anchors - new anchors
	 * @returns {void}
	 */
	setAnchors(anchors) {
		const a = anchors.slice();
		a[0] = { ...a[0], x: 0 };
		a[a.length - 1] = { ...a[a.length - 1], x: 1 };
		this.anchors.value = a;
	}


	/**
	 * Sets the sustain split position.
	 *
	 * @param {Number} v - 0..1
	 * @returns {void}
	 */
	setSplit(v) {
		this.split.value = clamp(v, 0, 1);
	}


	/**
	 * Sets the attack (pre-sustain) duration in seconds.
	 *
	 * @param {Number} s - seconds
	 * @returns {void}
	 */
	setAttackTime(s) {
		this.attackTime.value = clamp(s || MIN_TIME, MIN_TIME, MAX_TIME);
	}


	/**
	 * Sets the release duration in seconds.
	 *
	 * @param {Number} s - seconds
	 * @returns {void}
	 */
	setReleaseTime(s) {
		this.releaseTime.value = clamp(s || MIN_TIME, MIN_TIME, MAX_TIME);
	}


	/**
	 * Rasterizes one flattened segment into the per-bin max-y buffer.
	 *
	 * @param {Number} x0 - segment start x
	 * @param {Number} y0 - segment start y
	 * @param {Number} x1 - segment end x
	 * @param {Number} y1 - segment end y
	 * @param {Float64Array} maxY - per-bin accumulator
	 * @param {Number} n - bin count
	 * @returns {void}
	 */
	rasterSegment(x0, y0, x1, y1, maxY, n) {

		const bx0 = x0 * (n - 1);
		const bx1 = x1 * (n - 1);
		let i0 = Math.round(Math.min(bx0, bx1));
		let i1 = Math.round(Math.max(bx0, bx1));
		i0 = Math.max(0, i0);
		i1 = Math.min(n - 1, i1);

		for (let i = i0; i <= i1; i++) {
			const y = bx1 === bx0 ? Math.max(y0, y1) : y0 + (y1 - y0) * ((i - bx0) / (bx1 - bx0));
			if (y > maxY[i])
				maxY[i] = y;
		}
	}


	/**
	 * Samples the curve to n points as an upper silhouette, clamped to [0,1].
	 *
	 * @param {Number} [n=SAMPLE_RES] - sample count
	 * @returns {Float32Array}
	 */
	sample(n = SAMPLE_RES) {

		const out = new Float32Array(n);
		const anchors = this.anchors.value;
		if (!anchors || anchors.length < 2)
			return out;

		const maxY = new Float64Array(n).fill(-Infinity);
		let px = null;
		let py = null;

		for (let s = 0; s < anchors.length - 1; s++) {
			const a = anchors[s];
			const b = anchors[s + 1];
			const c1x = a.x + (a.handleOutX || 0);
			const c1y = a.y + (a.handleOutY || 0);
			const c2x = b.x + (b.handleInX || 0);
			const c2y = b.y + (b.handleInY || 0);

			for (let i = 0; i <= FLATTEN_STEPS; i++) {
				const t = i / FLATTEN_STEPS;
				const mt = 1 - t;
				const x = mt * mt * mt * a.x + 3 * mt * mt * t * c1x + 3 * mt * t * t * c2x + t * t * t * b.x;
				const y = mt * mt * mt * a.y + 3 * mt * mt * t * c1y + 3 * mt * t * t * c2y + t * t * t * b.y;
				if (px !== null)
					this.rasterSegment(px, py, x, y, maxY, n);
				px = x;
				py = y;
			}
		}

		let last = null;
		for (let i = 0; i < n; i++) {
			if (maxY[i] !== -Infinity)
				last = maxY[i];
			else if (last !== null)
				maxY[i] = last;
		}
		let next = null;
		for (let i = n - 1; i >= 0; i--) {
			if (maxY[i] !== -Infinity)
				next = maxY[i];
			else if (next !== null)
				maxY[i] = next;
		}

		for (let i = 0; i < n; i++) {
			const v = maxY[i] === -Infinity ? 0 : maxY[i];
			out[i] = v < 0 ? 0 : v > 1 ? 1 : v;
		}
		return out;
	}


	/**
	 * The held level: the curve value at the split.
	 *
	 * @returns {Number}
	 */
	sustainLevel() {
		const s = this.sample(SAMPLE_RES);
		const i = clamp(Math.round(this.split.value * (SAMPLE_RES - 1)), 0, SAMPLE_RES - 1);
		return s[i];
	}


	/**
	 * Splits the sampled curve at the sustain point into the attack segment
	 * (start -> split, the part played over attackTime) and the release segment
	 * (split -> end, played over releaseTime). Both are at least 2 samples.
	 *
	 * @returns {{ pre:Float32Array, rel:Float32Array }}
	 */
	segments() {
		const s = this.sample(SAMPLE_RES);
		const i = clamp(Math.round(this.split.value * (SAMPLE_RES - 1)), 1, SAMPLE_RES - 2);
		return { pre: s.slice(0, i + 1), rel: s.slice(i) };
	}


	/** @returns {Object} */
	toJSON() {
		return {
			anchors: this.anchors.value.map((a) => ({ ...a })),
			split: this.split.value,
			attackTime: this.attackTime.value,
			releaseTime: this.releaseTime.value
		};
	}


	/**
	 * Restores from serialized data, mutating this instance (so references held
	 * by the synth stay valid).
	 *
	 * @param {Object} data - output of toJSON()
	 * @returns {void}
	 */
	loadJSON(data) {
		if (!data)
			return;
		if (Array.isArray(data.anchors) && data.anchors.length >= 2) {
			const a = data.anchors.map((x) => ({ ...makeAnchor(x.x, x.y), ...x }));
			a[0].x = 0;
			a[a.length - 1].x = 1;
			this.anchors.value = a;
		}
		if (typeof data.split === "number")
			this.split.value = clamp(data.split, 0, 1);
		if (typeof data.attackTime === "number")
			this.attackTime.value = clamp(data.attackTime, MIN_TIME, MAX_TIME);
		if (typeof data.releaseTime === "number")
			this.releaseTime.value = clamp(data.releaseTime, MIN_TIME, MAX_TIME);
	}

}
