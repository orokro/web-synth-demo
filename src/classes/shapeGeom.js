/*
	shapeGeom.js
	------------

	Pure geometry helpers for the wave shaper. A shape is a unit primitive
	(square / circle / triangle defined in the [0,1] x [0,1] unit box) mapped
	into a free quad (4 corners in wave space) via bilinear interpolation — so
	the corner handles give skew/stretch and a rotate handle spins the quad.

	The shaper only needs, per output column, the shape's vertical span [lo, hi]
	(top edge of the audio is single-valued), which columnSpans() rasterizes from
	the transformed boundary polygon. No 2D polygon booleans required.
*/

// circle tessellation
const CIRCLE_SEGMENTS = 64;

/**
 * Linear interpolation between two points.
 *
 * @param {{x:Number,y:Number}} a - start
 * @param {{x:Number,y:Number}} b - end
 * @param {Number} t - 0..1
 * @returns {{x:Number,y:Number}}
 */
function lerp(a, b, t) {
	return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/**
 * Unit boundary points (u,v in [0,1], v=0 is the top edge) for a shape type.
 *
 * @param {String} type - "square" | "circle" | "triangle"
 * @returns {Array<{x:Number,y:Number}>}
 */
export function unitShape(type) {
	if (type === "circle") {
		const pts = [];
		for (let i = 0; i < CIRCLE_SEGMENTS; i++) {
			const a = (i / CIRCLE_SEGMENTS) * Math.PI * 2;
			pts.push({ x: 0.5 + 0.5 * Math.cos(a), y: 0.5 + 0.5 * Math.sin(a) });
		}
		return pts;
	}
	if (type === "triangle")
		return [{ x: 0.5, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
	// square
	return [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
}

/**
 * Maps a unit point (u,v) into a quad [TL, TR, BR, BL] via bilinear interp.
 *
 * @param {Array<{x:Number,y:Number}>} quad - 4 corners (TL, TR, BR, BL)
 * @param {Number} u - 0..1 across the top/bottom edges
 * @param {Number} v - 0..1 from top edge to bottom edge
 * @returns {{x:Number,y:Number}}
 */
export function bilinear(quad, u, v) {
	const top = lerp(quad[0], quad[1], u);
	const bottom = lerp(quad[3], quad[2], u);
	return lerp(top, bottom, v);
}

/**
 * The shape's boundary polygon in wave space (unit shape mapped through quad).
 *
 * @param {String} type - shape type
 * @param {Array<{x:Number,y:Number}>} quad - 4 corners (TL, TR, BR, BL)
 * @returns {Array<{x:Number,y:Number}>}
 */
export function transformedPolygon(type, quad) {
	return unitShape(type).map((p) => bilinear(quad, p.x, p.y));
}

/**
 * Per-column vertical span [lo, hi] of a boundary polygon, over n columns
 * (x in [0,1] -> column i = x*(n-1)). Uncovered columns get lo=+Inf, hi=-Inf.
 *
 * @param {Array<{x:Number,y:Number}>} poly - boundary polygon (implicitly closed)
 * @param {Number} n - column count
 * @returns {{lo:Float64Array, hi:Float64Array}}
 */
export function columnSpans(poly, n) {

	const lo = new Float64Array(n).fill(Infinity);
	const hi = new Float64Array(n).fill(-Infinity);

	const mark = (col, y) => {
		if (col < 0 || col >= n)
			return;
		if (y < lo[col]) lo[col] = y;
		if (y > hi[col]) hi[col] = y;
	};

	for (let e = 0; e < poly.length; e++) {
		const a = poly[e];
		const b = poly[(e + 1) % poly.length];
		const bx0 = a.x * (n - 1);
		const bx1 = b.x * (n - 1);

		if (Math.abs(bx1 - bx0) < 1e-9) {
			const col = Math.round(bx0);
			mark(col, a.y);
			mark(col, b.y);
			continue;
		}

		const i0 = Math.max(0, Math.ceil(Math.min(bx0, bx1)));
		const i1 = Math.min(n - 1, Math.floor(Math.max(bx0, bx1)));
		for (let i = i0; i <= i1; i++) {
			const t = (i - bx0) / (bx1 - bx0);
			mark(i, a.y + (b.y - a.y) * t);
		}
	}

	return { lo, hi };
}

/**
 * A default centered quad for a newly placed shape (TL, TR, BR, BL).
 *
 * @returns {Array<{x:Number,y:Number}>}
 */
export function defaultQuad() {
	return [
		{ x: 0.35, y: 0.5 },
		{ x: 0.65, y: 0.5 },
		{ x: 0.65, y: -0.5 },
		{ x: 0.35, y: -0.5 }
	];
}
