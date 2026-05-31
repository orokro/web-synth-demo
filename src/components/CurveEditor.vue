<!--
	CurveEditor.vue
	---------------

	Interactive bezier editor for a CustomWave. Draws the black design curve
	(which may fold back), the red "true profile" (upper silhouette = what plays),
	the anchors and handles, and an optional shaded fill.

	Tools (Phase 3b-1):
	  - Select: drag anchors (endpoints x-locked), shift-click to multi-select,
	    drag on empty space to box-select; drag handles too.
	  - Pen: click the curve to insert a point (de Casteljau), click+drag to
	    insert and move; click an existing point to delete it (deletes the whole
	    selection if any); drag a point to move it.
	  Handle drags follow the smooth/broken rule (smooth = opposite handle keeps
	  its length but mirrors direction; broken = independent). The Anchor tool
	  (break / zero / symmetric drag-out) arrives in 3b-2.

	All edits write back to source.anchors, so the sound updates live.
-->
<script setup>

// vue
import { computed, ref } from "vue";

// bezier projection for click-on-curve
import { Bezier } from "bezier-js";

// pure edit helpers
import { splitInsert, deleteAnchor, applyHandleDrag, segmentPoints } from "@/classes/curveTools.js";

const props = defineProps({
	// a CustomWave instance
	source: { type: Object, required: true }
});

// drawing space (stretched to fill via preserveAspectRatio="none")
const W = 1000;
const H = 400;

// screen-space hit thresholds (px) and drag threshold
const ANCHOR_HIT = 11;
const HANDLE_HIT = 10;
const PATH_HIT = 12;
const DRAG_THRESHOLD = 5;

// state
const svgEl = ref(null);
const tool = ref("select");
const selection = ref(new Set());
const showShade = ref(true);
const box = ref(null); // { x0, y0, x1, y1 } normalized, during box-select

// active drag (plain object, not reactive)
let drag = null;

/**
 * Clamps a number.
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
 * Deep-ish clones an anchor list (anchor objects copied).
 *
 * @param {Array<Object>} anchors - anchor list
 * @returns {Array<Object>}
 */
function cloneAnchors(anchors) {
	return anchors.map((a) => ({ ...a }));
}

/**
 * @param {Number} x - normalized x
 * @returns {Number} drawing-space x
 */
function mapX(x) {
	return x * W;
}

/**
 * @param {Number} y - normalized y
 * @returns {Number} drawing-space y (flipped)
 */
function mapY(y) {
	return (1 - y) / 2 * H;
}

// reactive anchors
const anchors = computed(() => props.source.getAnchors());

/**
 * The black design path string.
 *
 * @returns {String}
 */
const designPath = computed(() => {
	const a = anchors.value;
	if (!a || a.length < 2)
		return "";
	let d = `M ${mapX(a[0].x).toFixed(2)} ${mapY(a[0].y).toFixed(2)}`;
	for (let i = 0; i < a.length - 1; i++) {
		const { p1, p2, p3 } = segmentPoints(a, i);
		d += ` C ${mapX(p1.x).toFixed(2)} ${mapY(p1.y).toFixed(2)} ${mapX(p2.x).toFixed(2)} ${mapY(p2.y).toFixed(2)} ${mapX(p3.x).toFixed(2)} ${mapY(p3.y).toFixed(2)}`;
	}
	return d;
});

/**
 * The red true-profile polyline points (downsampled).
 *
 * @returns {String}
 */
const profilePoints = computed(() => {
	const s = props.source.getCycle();
	const n = s.length;
	const step = Math.max(1, Math.floor(n / 400));
	let pts = "";
	for (let i = 0; i < n; i += step)
		pts += `${(i / (n - 1) * W).toFixed(2)},${mapY(s[i]).toFixed(2)} `;
	return pts.trim();
});

/**
 * Shaded fill polygon points.
 *
 * @returns {String}
 */
const shadePoints = computed(() => `0,${H} ${profilePoints.value} ${W},${H}`);

/**
 * Visible handle endpoints for an anchor (skips zero/endpoint handles).
 *
 * @param {Object} a - anchor
 * @param {Number} index - anchor index
 * @returns {Array<{x:Number,y:Number,which:String}>}
 */
function handlesFor(a, index) {
	const list = [];
	const last = anchors.value.length - 1;
	if (index > 0 && (a.handleInX || a.handleInY))
		list.push({ x: mapX(a.x + a.handleInX), y: mapY(a.y + a.handleInY), which: "in" });
	if (index < last && (a.handleOutX || a.handleOutY))
		list.push({ x: mapX(a.x + a.handleOutX), y: mapY(a.y + a.handleOutY), which: "out" });
	return list;
}

/**
 * Pointer position in normalized wave space, plus the svg rect.
 *
 * @param {PointerEvent} e - the event
 * @returns {{ nx:Number, ny:Number, r:DOMRect }}
 */
function toNorm(e) {
	const r = svgEl.value.getBoundingClientRect();
	return {
		nx: (e.clientX - r.left) / r.width,
		ny: 1 - 2 * (e.clientY - r.top) / r.height,
		r
	};
}

/**
 * Screen position (px) of a normalized point within the svg.
 *
 * @param {Number} nx - normalized x
 * @param {Number} ny - normalized y
 * @param {DOMRect} r - svg rect
 * @returns {{x:Number,y:Number}}
 */
function toScreen(nx, ny, r) {
	return { x: r.left + nx * r.width, y: r.top + (1 - ny) / 2 * r.height };
}

/**
 * Finds the anchor under the pointer (screen-space), or -1.
 *
 * @param {Number} clientX - pointer x
 * @param {Number} clientY - pointer y
 * @param {DOMRect} r - svg rect
 * @returns {Number} anchor index or -1
 */
function hitAnchor(clientX, clientY, r) {
	const a = anchors.value;
	let best = -1;
	let bestD = ANCHOR_HIT;
	for (let i = 0; i < a.length; i++) {
		const s = toScreen(a[i].x, a[i].y, r);
		const d = Math.hypot(s.x - clientX, s.y - clientY);
		if (d < bestD) {
			bestD = d;
			best = i;
		}
	}
	return best;
}

/**
 * Finds the handle under the pointer, or null.
 *
 * @param {Number} clientX - pointer x
 * @param {Number} clientY - pointer y
 * @param {DOMRect} r - svg rect
 * @returns {{index:Number,which:String}|null}
 */
function hitHandle(clientX, clientY, r) {
	const a = anchors.value;
	let best = null;
	let bestD = HANDLE_HIT;
	for (let i = 0; i < a.length; i++) {
		for (const h of handlesFor(a[i], i)) {
			const sx = r.left + h.x / W * r.width;
			const sy = r.top + h.y / H * r.height;
			const d = Math.hypot(sx - clientX, sy - clientY);
			if (d < bestD) {
				bestD = d;
				best = { index: i, which: h.which };
			}
		}
	}
	return best;
}

/**
 * Projects the pointer onto the curve, returning the nearest segment + t.
 *
 * @param {Number} clientX - pointer x
 * @param {Number} clientY - pointer y
 * @param {DOMRect} r - svg rect
 * @returns {{segIndex:Number,t:Number}|null}
 */
function hitPath(clientX, clientY, r) {
	const a = anchors.value;
	const sx = (x) => r.left + x * r.width;
	const sy = (y) => r.top + (1 - y) / 2 * r.height;
	let best = null;
	let bestD = PATH_HIT;
	for (let i = 0; i < a.length - 1; i++) {
		const { p0, p1, p2, p3 } = segmentPoints(a, i);
		const curve = new Bezier(sx(p0.x), sy(p0.y), sx(p1.x), sy(p1.y), sx(p2.x), sy(p2.y), sx(p3.x), sy(p3.y));
		const proj = curve.project({ x: clientX, y: clientY });
		if (proj.d < bestD) {
			bestD = proj.d;
			best = { segIndex: i, t: proj.t };
		}
	}
	return best;
}

/**
 * Commits a new anchor list to the source (triggers cycle + audio update).
 *
 * @param {Array<Object>} next - new anchor list
 * @returns {void}
 */
function commit(next) {
	props.source.setAnchors(next);
}

/**
 * Toggles an index in the selection (returns a fresh Set for reactivity).
 *
 * @param {Number} index - anchor index
 * @returns {void}
 */
function toggleSelect(index) {
	const next = new Set(selection.value);
	if (next.has(index))
		next.delete(index);
	else
		next.add(index);
	selection.value = next;
}

/**
 * Handles pointer-down: hit-tests and starts the appropriate drag.
 *
 * @param {PointerEvent} e - the event
 * @returns {void}
 */
function onPointerDown(e) {

	e.preventDefault();
	svgEl.value.setPointerCapture(e.pointerId);

	const { nx, ny, r } = toNorm(e);
	const a = anchors.value;
	const handle = hitHandle(e.clientX, e.clientY, r);
	const anchorIdx = hitAnchor(e.clientX, e.clientY, r);

	const base = { startNX: nx, startNY: ny, startSX: e.clientX, startSY: e.clientY, moved: false };

	if (handle) {
		drag = { ...base, kind: "handle", index: handle.index, which: handle.which, orig: cloneAnchors(a), anchorX: a[handle.index].x, anchorY: a[handle.index].y };
		return;
	}

	if (tool.value === "select") {
		if (anchorIdx >= 0) {
			if (e.shiftKey) {
				toggleSelect(anchorIdx);
				drag = null;
				return;
			}
			if (!selection.value.has(anchorIdx))
				selection.value = new Set([anchorIdx]);
			drag = { ...base, kind: "anchorMove", indices: [...selection.value], orig: cloneAnchors(a) };
			return;
		}
		// empty: box select
		if (!e.shiftKey)
			selection.value = new Set();
		drag = { ...base, kind: "box", additive: e.shiftKey };
		box.value = { x0: nx, y0: ny, x1: nx, y1: ny };
		return;
	}

	if (tool.value === "pen") {
		if (anchorIdx >= 0) {
			// provisional: delete on click, move on drag
			drag = { ...base, kind: "penAnchor", index: anchorIdx, orig: cloneAnchors(a) };
			return;
		}
		const path = hitPath(e.clientX, e.clientY, r);
		if (path) {
			const res = splitInsert(a, path.segIndex, path.t);
			commit(res.anchors);
			selection.value = new Set();
			drag = { ...base, kind: "anchorMove", indices: [res.index], orig: cloneAnchors(res.anchors) };
			return;
		}
		drag = null;
		return;
	}

	drag = null;
}

/**
 * Handles pointer-move: applies the active drag.
 *
 * @param {PointerEvent} e - the event
 * @returns {void}
 */
function onPointerMove(e) {

	if (!drag)
		return;

	const { nx, ny } = toNorm(e);

	if (!drag.moved && Math.hypot(e.clientX - drag.startSX, e.clientY - drag.startSY) > DRAG_THRESHOLD)
		drag.moved = true;

	if (drag.kind === "box") {
		box.value = { x0: drag.startNX, y0: drag.startNY, x1: nx, y1: ny };
		return;
	}

	if (!drag.moved)
		return;

	// pen provisional becomes a move once dragged
	if (drag.kind === "penAnchor") {
		drag.kind = "anchorMove";
		drag.indices = [drag.index];
	}

	const dnx = nx - drag.startNX;
	const dny = ny - drag.startNY;
	const last = drag.orig.length - 1;

	if (drag.kind === "anchorMove") {
		const next = cloneAnchors(drag.orig);
		for (const i of drag.indices) {
			const o = drag.orig[i];
			next[i].x = i === 0 ? 0 : i === last ? 1 : clamp(o.x + dnx, 0, 1);
			next[i].y = clamp(o.y + dny, -1, 1);
		}
		commit(next);
		return;
	}

	if (drag.kind === "handle") {
		const next = cloneAnchors(drag.orig);
		const hx = nx - drag.anchorX;
		const hy = ny - drag.anchorY;
		applyHandleDrag(next[drag.index], drag.which, hx, hy);
		commit(next);
		return;
	}
}

/**
 * Handles pointer-up: finalizes box-select or pen click actions.
 *
 * @param {PointerEvent} e - the event
 * @returns {void}
 */
function onPointerUp(e) {

	if (!drag) {
		releaseCapture(e);
		return;
	}

	if (drag.kind === "box") {
		finalizeBox();
		box.value = null;
	} else if (drag.kind === "penAnchor" && !drag.moved) {
		deleteOnPenClick(drag.index);
	}

	drag = null;
	releaseCapture(e);
}

/**
 * Releases the pointer capture if held.
 *
 * @param {PointerEvent} e - the event
 * @returns {void}
 */
function releaseCapture(e) {
	if (svgEl.value && svgEl.value.hasPointerCapture && svgEl.value.hasPointerCapture(e.pointerId))
		svgEl.value.releasePointerCapture(e.pointerId);
}

/**
 * Selects anchors inside the box-select rectangle.
 *
 * @returns {void}
 */
function finalizeBox() {
	const b = box.value;
	if (!b)
		return;
	const xlo = Math.min(b.x0, b.x1);
	const xhi = Math.max(b.x0, b.x1);
	const ylo = Math.min(b.y0, b.y1);
	const yhi = Math.max(b.y0, b.y1);
	const next = drag.additive ? new Set(selection.value) : new Set();
	const a = anchors.value;
	for (let i = 0; i < a.length; i++) {
		if (a[i].x >= xlo && a[i].x <= xhi && a[i].y >= ylo && a[i].y <= yhi)
			next.add(i);
	}
	selection.value = next;
}

/**
 * Deletes the clicked point plus any selected interior points (pen click).
 *
 * @param {Number} index - the clicked anchor index
 * @returns {void}
 */
function deleteOnPenClick(index) {
	const targets = new Set(selection.value);
	targets.add(index);
	let a = anchors.value;
	const idxs = [...targets].filter((i) => i > 0 && i < a.length - 1).sort((x, y) => y - x);
	for (const i of idxs)
		a = deleteAnchor(a, i);
	commit(a);
	selection.value = new Set();
}

</script>
<template>

	<div class="curve-editor">
		<div class="toolbar">
			<div class="tools">
				<button type="button" :class="{ active: tool === 'select' }" @click="tool = 'select'">Select</button>
				<button type="button" :class="{ active: tool === 'pen' }" @click="tool = 'pen'">Pen</button>
				<button type="button" class="soon" disabled title="Coming in 3b-2">Anchor</button>
			</div>
			<label class="shade-toggle">
				<input type="checkbox" v-model="showShade" /> Shade
			</label>
			<span class="hint">
				<template v-if="tool === 'pen'">Click curve to add · click point to delete · drag to move</template>
				<template v-else>Drag points/handles · shift-click multi · drag empty to box-select</template>
			</span>
		</div>

		<div class="canvas-wrap">
			<svg
				ref="svgEl"
				class="canvas"
				:class="{ 'tool-pen': tool === 'pen' }"
				:viewBox="`0 0 ${W} ${H}`"
				preserveAspectRatio="none"
				@pointerdown="onPointerDown"
				@pointermove="onPointerMove"
				@pointerup="onPointerUp"
			>
				<rect x="0" y="0" :width="W" :height="H" class="bg" />
				<line x1="0" :y1="H / 2" :x2="W" :y2="H / 2" class="axis" />

				<polygon v-if="showShade" :points="shadePoints" class="shade" />
				<path :d="designPath" class="design" fill="none" />
				<polyline :points="profilePoints" class="profile" fill="none" />

				<g v-for="(a, i) in anchors" :key="'h' + i">
					<g v-for="(h, hi) in handlesFor(a, i)" :key="hi">
						<line :x1="mapX(a.x)" :y1="mapY(a.y)" :x2="h.x" :y2="h.y" class="handle-line" />
						<circle :cx="h.x" :cy="h.y" r="5" class="handle-dot" />
					</g>
				</g>

				<circle
					v-for="(a, i) in anchors"
					:key="'a' + i"
					:cx="mapX(a.x)"
					:cy="mapY(a.y)"
					r="6"
					class="anchor"
					:class="{ selected: selection.has(i) }"
				/>

				<rect
					v-if="box"
					:x="mapX(Math.min(box.x0, box.x1))"
					:y="mapY(Math.max(box.y0, box.y1))"
					:width="Math.abs(box.x1 - box.x0) * W"
					:height="Math.abs(box.y1 - box.y0) / 2 * H"
					class="select-box"
				/>
			</svg>
		</div>
	</div>

</template>
<style lang="scss" scoped>

	.curve-editor {
		display: flex;
		flex-direction: column;
		gap: 8px;
		flex: 1 1 auto;
		min-height: 260px;
	}

	.toolbar {
		display: flex;
		align-items: center;
		gap: 14px;
		flex: 0 0 auto;
		flex-wrap: wrap;

		.tools {
			display: flex;
			gap: 4px;

			button {
				padding: 5px 10px;
				font-size: 12px;
				border: 1px solid #444;
				border-radius: 4px;
				background: #2a2a30;
				color: #ccc;
				cursor: pointer;

				&:hover:not(:disabled) { background: #34343c; color: #fff; }
				&.active { background: var(--accent-dim); color: var(--accent); border-color: var(--accent-border); }
				&.soon { opacity: 0.5; cursor: default; }
			}
		}

		.shade-toggle {
			display: flex;
			align-items: center;
			gap: 6px;
			font-size: 12px;
			color: #bbb;
			cursor: pointer;
			input { accent-color: var(--accent); }
		}

		.hint { font-size: 11px; color: #666; }
	}

	.canvas-wrap {
		flex: 1 1 auto;
		min-height: 220px;
		background: #0a0a0c;
		border: 1px solid #2c2c32;
		border-radius: 6px;
		overflow: hidden;
	}

	.canvas {
		display: block;
		width: 100%;
		height: 100%;
		touch-action: none;

		&.tool-pen { cursor: crosshair; }
	}

	// only the background rect catches pointer events; visuals are pass-through
	.bg { fill: transparent; }
	.axis, .shade, .design, .profile, .handle-line, .handle-dot, .anchor, .select-box {
		pointer-events: none;
	}

	.axis { stroke: rgba(255, 255, 255, 0.12); stroke-width: 1; vector-effect: non-scaling-stroke; }
	.shade { fill: var(--accent-dim); }
	.design { stroke: #cccccc; stroke-width: 1.5; vector-effect: non-scaling-stroke; }
	.profile { stroke: #ff4d4d; stroke-width: 2; vector-effect: non-scaling-stroke; }
	.handle-line { stroke: #7a7a7a; stroke-width: 1; vector-effect: non-scaling-stroke; }
	.handle-dot { fill: #2a2a30; stroke: #9a9a9a; stroke-width: 1.5; vector-effect: non-scaling-stroke; }

	.anchor {
		fill: var(--accent);
		stroke: #04302f;
		stroke-width: 1.5;
		vector-effect: non-scaling-stroke;

		&.selected { fill: #fff; stroke: var(--accent); stroke-width: 2.5; }
	}

	.select-box {
		fill: var(--accent-dim);
		stroke: var(--accent);
		stroke-width: 1;
		vector-effect: non-scaling-stroke;
	}

</style>
