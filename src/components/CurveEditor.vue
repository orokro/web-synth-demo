<!--
	CurveEditor.vue
	---------------

	Interactive bezier editor for a CustomWave. Renders in real pixel space (the
	svg viewBox matches the element's pixel size, tracked with a ResizeObserver),
	so anchor/handle glyphs are true circles regardless of the pane's aspect.

	A wave-space "view rect" (x0..x1, y0..y1) maps onto the pixel area, giving
	pan (right-drag) and zoom (wheel), plus Fit (frame all anchors+handles, even
	out-of-bounds) and 1:1 (the canonical 0..1 x -1..1 frame). When the view
	extends past one cycle, ghost copies of the profile are drawn left/right.

	Tools:
	  - Select: drag anchors (endpoints x-locked), shift multi-select, box-select;
	    drag handles (smooth = mirror direction/keep length; broken = independent).
	  - Pen: click curve to insert (de Casteljau), click+drag insert-and-move,
	    click point to delete (whole selection if any), drag to move.
	  The Anchor tool (break / zero / symmetric drag-out) arrives in 3b-2.

	All edits write back to source.anchors so the sound updates live.
-->
<script setup>

// vue
import { computed, ref, onMounted, onBeforeUnmount } from "vue";

// bezier projection for click-on-curve
import { Bezier } from "bezier-js";

// pure edit helpers
import { splitInsert, deleteAnchor, applyHandleDrag, segmentPoints } from "@/classes/curveTools.js";

const props = defineProps({
	// a CustomWave instance
	source: { type: Object, required: true }
});

// screen-space hit thresholds (px) and drag threshold
const ANCHOR_HIT = 11;
const HANDLE_HIT = 10;
const PATH_HIT = 12;
const DRAG_THRESHOLD = 5;
const MIN_RANGE = 0.02;
const MAX_RANGE = 60;
const MAX_GHOSTS = 4;

// element pixel size (kept in sync via ResizeObserver)
const vw = ref(800);
const vh = ref(400);

// visible region in wave space
const view = ref({ x0: 0, x1: 1, y0: -1, y1: 1 });

// state
const svgEl = ref(null);
const tool = ref("select");
const selection = ref(new Set());
const showShade = ref(true);
const box = ref(null); // { x0, y0, x1, y1 } in wave coords during box-select

// active drag (plain object, not reactive)
let drag = null;
let resizeObserver = null;

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
 * Deep-ish clones an anchor list.
 *
 * @param {Array<Object>} anchors - anchor list
 * @returns {Array<Object>}
 */
function cloneAnchors(anchors) {
	return anchors.map((a) => ({ ...a }));
}

/**
 * Maps a wave x to pixel x under the current view.
 *
 * @param {Number} wx - wave x
 * @returns {Number} pixel x
 */
function sx(wx) {
	const v = view.value;
	return (wx - v.x0) / (v.x1 - v.x0) * vw.value;
}

/**
 * Maps a wave y to pixel y under the current view (flipped).
 *
 * @param {Number} wy - wave y
 * @returns {Number} pixel y
 */
function sy(wy) {
	const v = view.value;
	return (v.y1 - wy) / (v.y1 - v.y0) * vh.value;
}

// reactive anchors
const anchors = computed(() => props.source.getAnchors());

/**
 * Builds an svg path for a cubic between anchors, optionally x-shifted (ghosts).
 *
 * @param {Number} shift - x offset in wave units
 * @returns {String}
 */
function buildDesignPath(shift) {
	const a = anchors.value;
	if (!a || a.length < 2)
		return "";
	let d = `M ${sx(a[0].x + shift).toFixed(2)} ${sy(a[0].y).toFixed(2)}`;
	for (let i = 0; i < a.length - 1; i++) {
		const { p1, p2, p3 } = segmentPoints(a, i);
		d += ` C ${sx(p1.x + shift).toFixed(2)} ${sy(p1.y).toFixed(2)} ${sx(p2.x + shift).toFixed(2)} ${sy(p2.y).toFixed(2)} ${sx(p3.x + shift).toFixed(2)} ${sy(p3.y).toFixed(2)}`;
	}
	return d;
}

const designPath = computed(() => buildDesignPath(0));

/**
 * Builds the profile polyline points, optionally x-shifted (ghosts).
 *
 * @param {Number} shift - x offset in wave units
 * @returns {String}
 */
function buildProfile(shift) {
	const s = props.source.getCycle();
	const n = s.length;
	const step = Math.max(1, Math.floor(n / 500));
	let pts = "";
	for (let i = 0; i < n; i += step)
		pts += `${sx(i / (n - 1) + shift).toFixed(2)},${sy(s[i]).toFixed(2)} `;
	return pts.trim();
}

const profilePoints = computed(() => buildProfile(0));

/**
 * Closed polygon for the shaded fill under the main profile.
 *
 * @returns {String}
 */
const shadePoints = computed(() => `${sx(0).toFixed(2)},${sy(view.value.y0).toFixed(2)} ${profilePoints.value} ${sx(1).toFixed(2)},${sy(view.value.y0).toFixed(2)}`);

/**
 * Integer cycle offsets to draw as ghosts (excluding the main cycle).
 *
 * @returns {Array<Number>}
 */
const ghostOffsets = computed(() => {
	const v = view.value;
	const out = [];
	const lo = Math.max(-MAX_GHOSTS, Math.floor(v.x0));
	const hi = Math.min(MAX_GHOSTS, Math.ceil(v.x1) - 1);
	for (let k = lo; k <= hi; k++)
		if (k !== 0)
			out.push(k);
	return out;
});

/**
 * Visible handle endpoints for an anchor (skips zero/endpoint handles).
 *
 * @param {Object} a - anchor
 * @param {Number} index - anchor index
 * @returns {Array<{wx:Number,wy:Number,which:String}>}
 */
function handlesFor(a, index) {
	const list = [];
	const last = anchors.value.length - 1;
	if (index > 0 && (a.handleInX || a.handleInY))
		list.push({ wx: a.x + a.handleInX, wy: a.y + a.handleInY, which: "in" });
	if (index < last && (a.handleOutX || a.handleOutY))
		list.push({ wx: a.x + a.handleOutX, wy: a.y + a.handleOutY, which: "out" });
	return list;
}

/**
 * Pointer position in pixels relative to the svg, and in wave coords.
 *
 * @param {PointerEvent} e - the event
 * @returns {{ px:Number, py:Number, wx:Number, wy:Number }}
 */
function pointerInfo(e) {
	const r = svgEl.value.getBoundingClientRect();
	const px = e.clientX - r.left;
	const py = e.clientY - r.top;
	const v = view.value;
	return {
		px,
		py,
		wx: v.x0 + px / r.width * (v.x1 - v.x0),
		wy: v.y1 - py / r.height * (v.y1 - v.y0)
	};
}

/**
 * Finds the anchor under the pointer (pixel-space), or -1.
 *
 * @param {Number} px - pointer pixel x
 * @param {Number} py - pointer pixel y
 * @returns {Number}
 */
function hitAnchor(px, py) {
	const a = anchors.value;
	let best = -1;
	let bestD = ANCHOR_HIT;
	for (let i = 0; i < a.length; i++) {
		const d = Math.hypot(sx(a[i].x) - px, sy(a[i].y) - py);
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
 * @param {Number} px - pointer pixel x
 * @param {Number} py - pointer pixel y
 * @returns {{index:Number,which:String}|null}
 */
function hitHandle(px, py) {
	const a = anchors.value;
	let best = null;
	let bestD = HANDLE_HIT;
	for (let i = 0; i < a.length; i++) {
		for (const h of handlesFor(a[i], i)) {
			const d = Math.hypot(sx(h.wx) - px, sy(h.wy) - py);
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
 * @param {Number} px - pointer pixel x
 * @param {Number} py - pointer pixel y
 * @returns {{segIndex:Number,t:Number}|null}
 */
function hitPath(px, py) {
	const a = anchors.value;
	let best = null;
	let bestD = PATH_HIT;
	for (let i = 0; i < a.length - 1; i++) {
		const { p0, p1, p2, p3 } = segmentPoints(a, i);
		const curve = new Bezier(sx(p0.x), sy(p0.y), sx(p1.x), sy(p1.y), sx(p2.x), sy(p2.y), sx(p3.x), sy(p3.y));
		const proj = curve.project({ x: px, y: py });
		if (proj.d < bestD) {
			bestD = proj.d;
			best = { segIndex: i, t: proj.t };
		}
	}
	return best;
}

/**
 * Commits a new anchor list to the source.
 *
 * @param {Array<Object>} next - new anchor list
 * @returns {void}
 */
function commit(next) {
	props.source.setAnchors(next);
}

/**
 * Toggles an index in the selection.
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
 * Pointer-down: right button pans; otherwise hit-test and start a tool drag.
 *
 * @param {PointerEvent} e - the event
 * @returns {void}
 */
function onPointerDown(e) {

	svgEl.value.setPointerCapture(e.pointerId);
	const info = pointerInfo(e);

	// right (or middle) button → pan
	if (e.button === 2 || e.button === 1) {
		drag = { kind: "pan", startView: { ...view.value }, startCX: e.clientX, startCY: e.clientY };
		return;
	}

	e.preventDefault();
	const a = anchors.value;
	const handle = hitHandle(info.px, info.py);
	const anchorIdx = hitAnchor(info.px, info.py);
	const base = { startWX: info.wx, startWY: info.wy, startSX: e.clientX, startSY: e.clientY, moved: false };

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
		if (!e.shiftKey)
			selection.value = new Set();
		drag = { ...base, kind: "box", additive: e.shiftKey };
		box.value = { x0: info.wx, y0: info.wy, x1: info.wx, y1: info.wy };
		return;
	}

	if (tool.value === "pen") {
		if (anchorIdx >= 0) {
			drag = { ...base, kind: "penAnchor", index: anchorIdx, orig: cloneAnchors(a) };
			return;
		}
		const path = hitPath(info.px, info.py);
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
 * Pointer-move: applies the active drag.
 *
 * @param {PointerEvent} e - the event
 * @returns {void}
 */
function onPointerMove(e) {

	if (!drag)
		return;

	if (drag.kind === "pan") {
		const rangeX = drag.startView.x1 - drag.startView.x0;
		const rangeY = drag.startView.y1 - drag.startView.y0;
		const dwx = (e.clientX - drag.startCX) / vw.value * rangeX;
		const dwy = (e.clientY - drag.startCY) / vh.value * rangeY;
		view.value = {
			x0: drag.startView.x0 - dwx,
			x1: drag.startView.x1 - dwx,
			y0: drag.startView.y0 + dwy,
			y1: drag.startView.y1 + dwy
		};
		return;
	}

	const info = pointerInfo(e);

	if (drag.kind === "box") {
		box.value = { x0: drag.startWX, y0: drag.startWY, x1: info.wx, y1: info.wy };
		return;
	}

	if (!drag.moved && Math.hypot(e.clientX - drag.startSX, e.clientY - drag.startSY) > DRAG_THRESHOLD)
		drag.moved = true;
	if (!drag.moved)
		return;

	if (drag.kind === "penAnchor") {
		drag.kind = "anchorMove";
		drag.indices = [drag.index];
	}

	const dwx = info.wx - drag.startWX;
	const dwy = info.wy - drag.startWY;
	const last = drag.orig.length - 1;

	if (drag.kind === "anchorMove") {
		const next = cloneAnchors(drag.orig);
		for (const i of drag.indices) {
			const o = drag.orig[i];
			next[i].x = i === 0 ? 0 : i === last ? 1 : clamp(o.x + dwx, 0, 1);
			next[i].y = clamp(o.y + dwy, -1, 1);
		}
		commit(next);
		return;
	}

	if (drag.kind === "handle") {
		const next = cloneAnchors(drag.orig);
		applyHandleDrag(next[drag.index], drag.which, info.wx - drag.anchorX, info.wy - drag.anchorY);
		commit(next);
	}
}

/**
 * Pointer-up: finalizes box-select or pen click actions.
 *
 * @param {PointerEvent} e - the event
 * @returns {void}
 */
function onPointerUp(e) {

	if (drag) {
		if (drag.kind === "box") {
			finalizeBox();
			box.value = null;
		} else if (drag.kind === "penAnchor" && !drag.moved) {
			deleteOnPenClick(drag.index);
		}
		drag = null;
	}

	if (svgEl.value && svgEl.value.hasPointerCapture(e.pointerId))
		svgEl.value.releasePointerCapture(e.pointerId);
}

/**
 * Mouse wheel zooms around the cursor.
 *
 * @param {WheelEvent} e - the event
 * @returns {void}
 */
function onWheel(e) {
	e.preventDefault();
	const info = pointerInfo(e);
	const v = view.value;
	const factor = e.deltaY > 0 ? 1.12 : 1 / 1.12;
	let rx = clamp((v.x1 - v.x0) * factor, MIN_RANGE, MAX_RANGE);
	let ry = clamp((v.y1 - v.y0) * factor, MIN_RANGE, MAX_RANGE);
	view.value = {
		x0: info.wx - info.px / vw.value * rx,
		x1: info.wx - info.px / vw.value * rx + rx,
		y0: info.wy + info.py / vh.value * ry - ry,
		y1: info.wy + info.py / vh.value * ry
	};
}

/**
 * Frames the canonical 0..1 x -1..1 view.
 *
 * @returns {void}
 */
function viewHome() {
	view.value = { x0: 0, x1: 1, y0: -1, y1: 1 };
}

/**
 * Frames all anchors and handle endpoints (including out-of-bounds), padded.
 *
 * @returns {void}
 */
function viewFit() {
	const a = anchors.value;
	let minX = 0;
	let maxX = 1;
	let minY = -0.3;
	let maxY = 0.3;
	for (const an of a) {
		const xs = [an.x, an.x + (an.handleInX || 0), an.x + (an.handleOutX || 0)];
		const ys = [an.y, an.y + (an.handleInY || 0), an.y + (an.handleOutY || 0)];
		minX = Math.min(minX, ...xs);
		maxX = Math.max(maxX, ...xs);
		minY = Math.min(minY, ...ys);
		maxY = Math.max(maxY, ...ys);
	}
	const padX = (maxX - minX) * 0.08 + 0.03;
	const padY = (maxY - minY) * 0.08 + 0.05;
	view.value = { x0: minX - padX, x1: maxX + padX, y0: minY - padY, y1: maxY + padY };
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
	for (let i = 0; i < a.length; i++)
		if (a[i].x >= xlo && a[i].x <= xhi && a[i].y >= ylo && a[i].y <= yhi)
			next.add(i);
	selection.value = next;
}

/**
 * Deletes the clicked point plus any selected interior points (pen click).
 *
 * @param {Number} index - clicked anchor index
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

onMounted(() => {
	const el = svgEl.value;
	const measure = () => {
		const r = el.getBoundingClientRect();
		if (r.width)
			vw.value = r.width;
		if (r.height)
			vh.value = r.height;
	};
	measure();
	resizeObserver = new ResizeObserver(measure);
	resizeObserver.observe(el);
});

onBeforeUnmount(() => {
	if (resizeObserver)
		resizeObserver.disconnect();
});

</script>
<template>

	<div class="curve-editor">
		<div class="toolbar">
			<div class="tools">
				<button type="button" :class="{ active: tool === 'select' }" @click="tool = 'select'">Select</button>
				<button type="button" :class="{ active: tool === 'pen' }" @click="tool = 'pen'">Pen</button>
				<button type="button" class="soon" disabled title="Coming in 3b-2">Anchor</button>
			</div>
			<div class="tools">
				<button type="button" @click="viewFit" title="Frame everything (incl. out-of-bounds handles)">Fit</button>
				<button type="button" @click="viewHome" title="Reset to 0..1 x -1..1">1:1</button>
			</div>
			<label class="shade-toggle">
				<input type="checkbox" v-model="showShade" /> Shade
			</label>
			<span class="hint">Right-drag pan · wheel zoom</span>
		</div>

		<div class="canvas-wrap">
			<svg
				ref="svgEl"
				class="canvas"
				:class="{ 'tool-pen': tool === 'pen' }"
				:viewBox="`0 0 ${vw} ${vh}`"
				preserveAspectRatio="none"
				@pointerdown="onPointerDown"
				@pointermove="onPointerMove"
				@pointerup="onPointerUp"
				@wheel="onWheel"
				@contextmenu.prevent
			>
				<rect x="0" y="0" :width="vw" :height="vh" class="bg" />

				<!-- cycle boundary verticals + zero axis -->
				<line :x1="sx(0)" y1="0" :x2="sx(0)" :y2="vh" class="boundary" />
				<line :x1="sx(1)" y1="0" :x2="sx(1)" :y2="vh" class="boundary" />
				<line x1="0" :y1="sy(0)" :x2="vw" :y2="sy(0)" class="axis" />

				<!-- ghost profile repeats -->
				<polyline v-for="k in ghostOffsets" :key="'g' + k" :points="buildProfile(k)" class="ghost" fill="none" />

				<!-- shaded true-profile area (main cycle) -->
				<polygon v-if="showShade" :points="shadePoints" class="shade" />

				<!-- black design curve -->
				<path :d="designPath" class="design" fill="none" />

				<!-- red true-profile line -->
				<polyline :points="profilePoints" class="profile" fill="none" />

				<!-- handles -->
				<g v-for="(a, i) in anchors" :key="'h' + i">
					<g v-for="(h, hi) in handlesFor(a, i)" :key="hi">
						<line :x1="sx(a.x)" :y1="sy(a.y)" :x2="sx(h.wx)" :y2="sy(h.wy)" class="handle-line" />
						<circle :cx="sx(h.wx)" :cy="sy(h.wy)" r="5" class="handle-dot" />
					</g>
				</g>

				<!-- anchors -->
				<circle
					v-for="(a, i) in anchors"
					:key="'a' + i"
					:cx="sx(a.x)"
					:cy="sy(a.y)"
					r="6"
					class="anchor"
					:class="{ selected: selection.has(i) }"
				/>

				<!-- box select -->
				<rect
					v-if="box"
					:x="sx(Math.min(box.x0, box.x1))"
					:y="sy(Math.max(box.y0, box.y1))"
					:width="Math.abs(sx(box.x1) - sx(box.x0))"
					:height="Math.abs(sy(box.y1) - sy(box.y0))"
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

	.bg { fill: transparent; }
	.axis, .boundary, .shade, .design, .profile, .ghost, .handle-line, .handle-dot, .anchor, .select-box {
		pointer-events: none;
	}

	.axis { stroke: rgba(255, 255, 255, 0.14); stroke-width: 1; }
	.boundary { stroke: rgba(255, 255, 255, 0.08); stroke-width: 1; }
	.shade { fill: var(--accent-dim); }
	.design { stroke: #cccccc; stroke-width: 1.5; }
	.profile { stroke: #ff4d4d; stroke-width: 2; }
	.ghost { stroke: rgba(255, 77, 77, 0.28); stroke-width: 1.5; stroke-dasharray: 4 4; }
	.handle-line { stroke: #7a7a7a; stroke-width: 1; }
	.handle-dot { fill: #2a2a30; stroke: #9a9a9a; stroke-width: 1.5; }

	.anchor {
		fill: var(--accent);
		stroke: #04302f;
		stroke-width: 1.5;

		&.selected { fill: #fff; stroke: var(--accent); stroke-width: 2.5; }
	}

	.select-box {
		fill: var(--accent-dim);
		stroke: var(--accent);
		stroke-width: 1;
	}

</style>
