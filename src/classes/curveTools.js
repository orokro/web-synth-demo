/*
	curveTools.js
	-------------

	Pure geometry helpers for editing a CustomWave's bezier anchors. No vue, no
	DOM — just math, so it is easy to unit-test and reuse. All coordinates are in
	the wave's normalized space (x 0..1, y -1..1); handles are offsets in anchor-
	local space.
*/

/**
 * Linear interpolation between two points.
 *
 * @param {{x:Number,y:Number}} a - start
 * @param {{x:Number,y:Number}} b - end
 * @param {Number} t - 0..1
 * @returns {{x:Number,y:Number}}
 */
export function lerpPt(a, b, t) {
	return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}


/**
 * Absolute control points of the cubic segment between anchors i and i+1.
 *
 * @param {Array<Object>} anchors - anchor list
 * @param {Number} i - segment index (left anchor)
 * @returns {{p0:Object,p1:Object,p2:Object,p3:Object}}
 */
export function segmentPoints(anchors, i) {
	const a = anchors[i];
	const b = anchors[i + 1];
	return {
		p0: { x: a.x, y: a.y },
		p1: { x: a.x + (a.handleOutX || 0), y: a.y + (a.handleOutY || 0) },
		p2: { x: b.x + (b.handleInX || 0), y: b.y + (b.handleInY || 0) },
		p3: { x: b.x, y: b.y }
	};
}


/**
 * Inserts an anchor by splitting segment segIndex at parameter t using de
 * Casteljau, which preserves the curve's shape. The neighbours' adjacent
 * handles are updated to match; the new anchor gets smooth (non-broken) handles.
 *
 * @param {Array<Object>} anchors - anchor list
 * @param {Number} segIndex - segment to split (left anchor index)
 * @param {Number} t - split parameter 0..1
 * @returns {{ anchors: Array<Object>, index: Number }} new list and new anchor index
 */
export function splitInsert(anchors, segIndex, t) {

	const a = { ...anchors[segIndex] };
	const b = { ...anchors[segIndex + 1] };
	const { p0, p1, p2, p3 } = segmentPoints(anchors, segIndex);

	const A = lerpPt(p0, p1, t);
	const B = lerpPt(p1, p2, t);
	const C = lerpPt(p2, p3, t);
	const D = lerpPt(A, B, t);
	const E = lerpPt(B, C, t);
	const M = lerpPt(D, E, t);

	// left anchor keeps its position, gets the new shortened out-handle
	a.handleOutX = A.x - p0.x;
	a.handleOutY = A.y - p0.y;

	// right anchor keeps its position, gets the new shortened in-handle
	b.handleInX = C.x - p3.x;
	b.handleInY = C.y - p3.y;

	const mid = {
		x: M.x,
		y: M.y,
		handleInX: D.x - M.x,
		handleInY: D.y - M.y,
		handleOutX: E.x - M.x,
		handleOutY: E.y - M.y,
		isBroken: false
	};

	const out = anchors.slice();
	out[segIndex] = a;
	out[segIndex + 1] = b;
	out.splice(segIndex + 1, 0, mid);
	return { anchors: out, index: segIndex + 1 };
}


/**
 * Removes an interior anchor by index. Endpoints (first/last) are never removed.
 *
 * @param {Array<Object>} anchors - anchor list
 * @param {Number} index - anchor to remove
 * @returns {Array<Object>} new anchor list
 */
export function deleteAnchor(anchors, index) {
	if (index <= 0 || index >= anchors.length - 1)
		return anchors.slice();
	const out = anchors.slice();
	out.splice(index, 1);
	return out;
}


/**
 * Applies a handle drag to an anchor, honoring the broken/smooth rule:
 *  - smooth (not broken): the opposite handle keeps its own length but mirrors
 *    the dragged handle's direction (rotation locked together);
 *  - broken: only the dragged handle changes.
 * Mutates and returns the given anchor object.
 *
 * @param {Object} anchor - the anchor (mutated)
 * @param {String} which - "in" or "out"
 * @param {Number} hx - new handle x offset (anchor-local)
 * @param {Number} hy - new handle y offset (anchor-local)
 * @returns {Object} the anchor
 */
export function applyHandleDrag(anchor, which, hx, hy) {

	if (which === "in") {
		anchor.handleInX = hx;
		anchor.handleInY = hy;
	} else {
		anchor.handleOutX = hx;
		anchor.handleOutY = hy;
	}

	if (!anchor.isBroken) {
		const len = Math.hypot(hx, hy);
		const otherX = which === "in" ? "handleOutX" : "handleInX";
		const otherY = which === "in" ? "handleOutY" : "handleInY";
		const oppLen = Math.hypot(anchor[otherX] || 0, anchor[otherY] || 0);
		if (len > 1e-6 && oppLen > 1e-6) {
			anchor[otherX] = -hx / len * oppLen;
			anchor[otherY] = -hy / len * oppLen;
		}
	}

	return anchor;
}
