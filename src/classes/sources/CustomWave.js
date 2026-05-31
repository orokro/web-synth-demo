/*
	CustomWave.js
	-------------

	A user-drawn single-cycle waveform, stored as a list of bezier anchors.
	The editor (later phases) gives the user full freedom, so the visible curve
	may fold back on itself; the *audible* wave is the "true profile" — the upper
	silhouette of the curve at each x. getCycle() computes exactly that, so the
	red profile line drawn in the editor and the sound are the same thing.

	Anchor format (all normalized; handles are offsets in anchor-local space):
		{ x: 0..1, y: -1..1,
		  handleInX, handleInY,    // left/"in" control offset (unused on first anchor)
		  handleOutX, handleOutY,  // right/"out" control offset (unused on last anchor)
		  isBroken }               // true once the anchor tool splits the handles

	The first anchor is pinned to x=0 and the last to x=1; neither can be deleted.
*/

// base
import WaveSource, { CYCLE_RESOLUTION } from "./WaveSource.js";

// vue
import { shallowRef } from "vue";

// flattening resolution per bezier segment
const FLATTEN_STEPS = 64;

/**
 * Makes a default anchor.
 *
 * @param {Number} x - normalized x (0-1)
 * @param {Number} y - normalized y (-1..1)
 * @returns {Object}
 */
function makeAnchor(x, y) {
	return { x, y, handleInX: 0, handleInY: 0, handleOutX: 0, handleOutY: 0, isBroken: false };
}

// main export
export default class CustomWave extends WaveSource {

	/**
	 * @param {Object} [opts]
	 * @param {String} [opts.id]
	 * @param {String} [opts.name="Custom"]
	 * @param {Array<Object>} [opts.anchors] - anchor list; defaults to a -1..1 ramp
	 */
	constructor(opts = {}) {

		super({ id: opts.id, name: opts.name ?? "Custom", type: "custom" });

		const anchors = Array.isArray(opts.anchors) && opts.anchors.length >= 2
			? opts.anchors.map((a) => ({ ...makeAnchor(a.x, a.y), ...a }))
			: [makeAnchor(0, -1), makeAnchor(1, 1)];

		// pin endpoints
		anchors[0].x = 0;
		anchors[anchors.length - 1].x = 1;

		this.anchors = shallowRef(anchors);
	}


	/**
	 * Returns the current anchor list.
	 *
	 * @returns {Array<Object>}
	 */
	getAnchors() {
		return this.anchors.value;
	}


	/**
	 * Replaces the anchor list (used by the editor); triggers cycle recompute.
	 *
	 * @param {Array<Object>} anchors - new anchor list
	 * @returns {void}
	 */
	setAnchors(anchors) {
		this.anchors.value = anchors;
	}


	/**
	 * Rasterizes one flattened segment into the per-bin max-y buffer (upper
	 * silhouette), interpolating y across the bins the segment spans.
	 *
	 * @param {Number} x0 - segment start x (0-1)
	 * @param {Number} y0 - segment start y
	 * @param {Number} x1 - segment end x (0-1)
	 * @param {Number} y1 - segment end y
	 * @param {Float64Array} maxY - per-bin max-y accumulator
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
	 * Builds one cycle by flattening every bezier segment and taking the upper
	 * silhouette, then filling any gaps and clamping to [-1, 1].
	 *
	 * @returns {Float32Array}
	 */
	generate() {

		const n = CYCLE_RESOLUTION;
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

		// forward-fill gaps, then back-fill any leading gap, then clamp
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
			out[i] = v < -1 ? -1 : v > 1 ? 1 : v;
		}

		return out;
	}


	/**
	 * @returns {Object}
	 */
	toJSON() {
		return {
			...super.toJSON(),
			anchors: this.anchors.value.map((a) => ({ ...a }))
		};
	}


	/**
	 * Rebuilds a CustomWave from serialized data.
	 *
	 * @param {Object} data - output of toJSON()
	 * @returns {CustomWave}
	 */
	static fromJSON(data) {
		return new CustomWave(data);
	}

}
