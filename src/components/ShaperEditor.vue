<!--
	ShaperEditor.vue
	----------------

	Editor for a ShapedWave: sculpt a base wave with vector shapes. Reuses the
	pixel-space canvas with pan (right-drag) / zoom (wheel) / Fit / 1:1 and
	repeating ghosts, like the curve editor.

	Each shape is a unit primitive mapped into a free quad. When selected it shows
	four corner handles (drag = skew/stretch), a rotate handle, and can be dragged
	by its body to move. Per-shape mode is add or subtract (clip). The base is an
	optional referenced source repeated `freq` times, else a flat line. The red
	profile = the audible sculpted result.
-->
<script setup>

// vue
import { computed, ref, inject, onMounted, onBeforeUnmount } from "vue";

// geometry + widgets
import { transformedPolygon, defaultQuad } from "@/classes/shapeGeom.js";
import { SHAPE_TYPES } from "@/classes/sources/ShapedWave.js";
import JogWheel from "@/components/widgets/JogWheel.vue";

const props = defineProps({
	// a ShapedWave instance
	source: { type: Object, required: true }
});

// shared app state
const app = inject("app");

const HANDLE_HIT = 11;
const ROTATE_OFFSET = 26;
const MIN_RANGE = 0.02;
const MAX_RANGE = 60;
const MAX_GHOSTS = 4;

const SHAPE_ICONS = { square: "square", circle: "circle", triangle: "change_history" };

// pixel size + view rect
const vw = ref(800);
const vh = ref(400);
const view = ref({ x0: 0, x1: 1, y0: -1, y1: 1 });

const svgEl = ref(null);
const selectedId = ref(null);
const showShade = ref(true);
let drag = null;
let resizeObserver = null;

const shapes = computed(() => props.source.getShapes());
const input = computed(() => props.source.getInput());
const selectedShape = computed(() => shapes.value.find((s) => s.id === selectedId.value) || null);

// sources usable as the base (no self / cycle)
const available = computed(() => app.sources.value.filter((s) => app.canReference(props.source.id, s.id)));

/** @param {Number} wx @returns {Number} */
function sx(wx) {
	const v = view.value;
	return (wx - v.x0) / (v.x1 - v.x0) * vw.value;
}

/** @param {Number} wy @returns {Number} */
function sy(wy) {
	const v = view.value;
	return (v.y1 - wy) / (v.y1 - v.y0) * vh.value;
}

/** @param {Number} px @returns {Number} */
function ux(px) {
	const v = view.value;
	return v.x0 + px / vw.value * (v.x1 - v.x0);
}

/** @param {Number} py @returns {Number} */
function uy(py) {
	const v = view.value;
	return v.y1 - py / vh.value * (v.y1 - v.y0);
}

/**
 * Base height field for display (faint line): input repeated, or flat -1.
 *
 * @returns {Float32Array}
 */
function baseSamples() {
	const n = 2048;
	const out = new Float32Array(n);
	const inp = input.value;
	const src = inp ? app.getSource(inp.sourceId) : null;
	if (!src) {
		out.fill(-1);
		return out;
	}
	const cyc = src.getCycle();
	const freq = inp.frequency || 1;
	for (let i = 0; i < n; i++) {
		let phase = (i / n) * freq % 1;
		if (phase < 0)
			phase += 1;
		const sp = phase * n;
		const k = Math.floor(sp);
		out[i] = cyc[k % n] + (cyc[(k + 1) % n] - cyc[k % n]) * (sp - k);
	}
	return out;
}

/**
 * Polyline points for a sample array, x-shifted by `shift` cycles.
 *
 * @param {Float32Array} s - samples
 * @param {Number} shift - x offset in cycles
 * @returns {String}
 */
function profileToPoints(s, shift) {
	const n = s.length;
	const step = Math.max(1, Math.floor(n / 500));
	let pts = "";
	for (let i = 0; i < n; i += step)
		pts += `${sx(i / (n - 1) + shift).toFixed(2)},${sy(s[i]).toFixed(2)} `;
	return pts.trim();
}

const profilePoints = computed(() => profileToPoints(props.source.getCycle(), 0));
const basePoints = computed(() => profileToPoints(baseSamples(), 0));
const shadePoints = computed(() => `${sx(0).toFixed(2)},${sy(view.value.y0).toFixed(2)} ${profilePoints.value} ${sx(1).toFixed(2)},${sy(view.value.y0).toFixed(2)}`);

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
 * Screen-space polygon points string for a shape.
 *
 * @param {Object} shape - shape descriptor
 * @returns {String}
 */
function shapePoints(shape) {
	return transformedPolygon(shape.type, shape.quad).map((p) => `${sx(p.x).toFixed(2)},${sy(p.y).toFixed(2)}`).join(" ");
}

/**
 * Screen centroid of a quad.
 *
 * @param {Array<{x:Number,y:Number}>} quad - corners
 * @returns {{x:Number,y:Number}}
 */
function centroidScreen(quad) {
	let x = 0;
	let y = 0;
	for (const c of quad) {
		x += sx(c.x);
		y += sy(c.y);
	}
	return { x: x / 4, y: y / 4 };
}

/**
 * Screen position of a shape's rotate handle (above its top edge).
 *
 * @param {Object} shape - shape
 * @returns {{x:Number,y:Number}}
 */
function rotateHandleScreen(shape) {
	const q = shape.quad;
	const mx = (sx(q[0].x) + sx(q[1].x)) / 2;
	const my = (sy(q[0].y) + sy(q[1].y)) / 2;
	return { x: mx, y: my - ROTATE_OFFSET };
}

// quad edges: verts = the two corner indices on the edge; opp = the opposite edge's corners
const QUAD_EDGES = [
	{ verts: [0, 1], opp: [3, 2] },
	{ verts: [1, 2], opp: [0, 3] },
	{ verts: [2, 3], opp: [1, 0] },
	{ verts: [3, 0], opp: [2, 1] }
];

/**
 * Wave-space midpoint of two quad corners.
 *
 * @param {Array<{x:Number,y:Number}>} quad - corners
 * @param {Array<Number>} idx - two corner indices
 * @returns {{x:Number,y:Number}}
 */
function midOf(quad, idx) {
	return { x: (quad[idx[0]].x + quad[idx[1]].x) / 2, y: (quad[idx[0]].y + quad[idx[1]].y) / 2 };
}

/**
 * Screen midpoint of an edge.
 *
 * @param {Array<{x:Number,y:Number}>} quad - corners
 * @param {Number} e - edge index 0..3
 * @returns {{x:Number,y:Number}}
 */
function edgeMidScreen(quad, e) {
	const v = QUAD_EDGES[e].verts;
	return { x: (sx(quad[v[0]].x) + sx(quad[v[1]].x)) / 2, y: (sy(quad[v[0]].y) + sy(quad[v[1]].y)) / 2 };
}

/**
 * Uniformly scales the quad about an anchor so the moving reference point
 * follows the pointer along the anchor->reference axis (aspect-locked).
 *
 * @param {Array<{x:Number,y:Number}>} orig - original quad
 * @param {{x:Number,y:Number}} anchor - fixed point
 * @param {{x:Number,y:Number}} reference - point that should track the pointer
 * @param {{wx:Number,wy:Number}} info - pointer in wave space
 * @returns {Array<{x:Number,y:Number}>}
 */
function scaleQuadToPointer(orig, anchor, reference, info) {
	const dx = reference.x - anchor.x;
	const dy = reference.y - anchor.y;
	const len = Math.hypot(dx, dy) || 1e-6;
	const ax = dx / len;
	const ay = dy / len;
	const proj = (info.wx - anchor.x) * ax + (info.wy - anchor.y) * ay;
	const scale = Math.max(0.02, proj / len);
	return orig.map((p) => ({ x: anchor.x + (p.x - anchor.x) * scale, y: anchor.y + (p.y - anchor.y) * scale }));
}

/**
 * Point-in-polygon test (wave space).
 *
 * @param {Number} wx - x
 * @param {Number} wy - y
 * @param {Array<{x:Number,y:Number}>} poly - polygon
 * @returns {Boolean}
 */
function pointInPolygon(wx, wy, poly) {
	let inside = false;
	for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
		const xi = poly[i].x;
		const yi = poly[i].y;
		const xj = poly[j].x;
		const yj = poly[j].y;
		if (((yi > wy) !== (yj > wy)) && (wx < (xj - xi) * (wy - yi) / (yj - yi) + xi))
			inside = !inside;
	}
	return inside;
}

/**
 * Pointer info: svg-relative pixels and wave coords.
 *
 * @param {PointerEvent} e - event
 * @returns {{px:Number,py:Number,wx:Number,wy:Number}}
 */
function pointerInfo(e) {
	const r = svgEl.value.getBoundingClientRect();
	const px = e.clientX - r.left;
	const py = e.clientY - r.top;
	return { px, py, wx: ux(px), wy: uy(py) };
}

/**
 * Replaces a shape's quad (and commits).
 *
 * @param {String} id - shape id
 * @param {Array<{x:Number,y:Number}>} quad - new quad
 * @returns {void}
 */
function setQuad(id, quad) {
	props.source.setShapes(shapes.value.map((s) => (s.id === id ? { ...s, quad } : s)));
}

/**
 * Adds a shape of the given type, selected.
 *
 * @param {String} type - shape type
 * @returns {void}
 */
function addShape(type) {
	const shape = { type, mode: "add", quad: defaultQuad() };
	const next = [...shapes.value.map((s) => ({ ...s })), shape];
	props.source.setShapes(next);
	selectedId.value = props.source.getShapes()[props.source.getShapes().length - 1].id;
}

/**
 * Sets the selected shape's mode.
 *
 * @param {String} mode - "add" or "subtract"
 * @returns {void}
 */
function setMode(mode) {
	if (!selectedShape.value)
		return;
	props.source.setShapes(shapes.value.map((s) => (s.id === selectedId.value ? { ...s, mode } : s)));
}

/**
 * Deletes the selected shape.
 *
 * @returns {void}
 */
function deleteSelected() {
	if (!selectedId.value)
		return;
	props.source.setShapes(shapes.value.filter((s) => s.id !== selectedId.value));
	selectedId.value = null;
}

/**
 * Changes the base input source.
 *
 * @param {Event} event - select change
 * @returns {void}
 */
function onInputChange(event) {
	const id = event.target.value;
	props.source.setInput(id ? { sourceId: id, frequency: input.value ? input.value.frequency : 1 } : null);
}

/**
 * Sets the base input frequency.
 *
 * @param {Number} freq - frequency
 * @returns {void}
 */
function setFreq(freq) {
	if (input.value)
		props.source.setInput({ sourceId: input.value.sourceId, frequency: freq });
}

/**
 * Pointer down: pan, handle drag, move, or select.
 *
 * @param {PointerEvent} e - event
 * @returns {void}
 */
function onPointerDown(e) {

	svgEl.value.setPointerCapture(e.pointerId);
	const info = pointerInfo(e);

	if (e.button === 2 || e.button === 1) {
		drag = { kind: "pan", startView: { ...view.value }, startCX: e.clientX, startCY: e.clientY };
		return;
	}

	e.preventDefault();

	const sel = selectedShape.value;
	if (sel) {
		// rotate handle?
		const rh = rotateHandleScreen(sel);
		if (Math.hypot(rh.x - info.px, rh.y - info.py) < HANDLE_HIT) {
			const c = centroidScreen(sel.quad);
			drag = { kind: "rotate", id: sel.id, orig: sel.quad.map((p) => ({ ...p })), cx: c.x, cy: c.y, startAngle: Math.atan2(info.py - c.y, info.px - c.x) };
			return;
		}
		// corner handle?
		for (let i = 0; i < 4; i++) {
			if (Math.hypot(sx(sel.quad[i].x) - info.px, sy(sel.quad[i].y) - info.py) < HANDLE_HIT) {
				drag = { kind: "corner", id: sel.id, cornerIndex: i, orig: sel.quad.map((p) => ({ ...p })), startWX: info.wx, startWY: info.wy };
				return;
			}
		}
		// edge handle?
		for (let e = 0; e < 4; e++) {
			const m = edgeMidScreen(sel.quad, e);
			if (Math.hypot(m.x - info.px, m.y - info.py) < HANDLE_HIT) {
				drag = { kind: "edge", id: sel.id, edgeIndex: e, orig: sel.quad.map((p) => ({ ...p })), startWX: info.wx, startWY: info.wy };
				return;
			}
		}
	}

	// hit a shape body (topmost first) -> select + move
	for (let i = shapes.value.length - 1; i >= 0; i--) {
		const s = shapes.value[i];
		if (pointInPolygon(info.wx, info.wy, transformedPolygon(s.type, s.quad))) {
			selectedId.value = s.id;
			drag = { kind: "move", id: s.id, orig: s.quad.map((p) => ({ ...p })), startWX: info.wx, startWY: info.wy };
			return;
		}
	}

	// empty -> deselect
	selectedId.value = null;
	drag = null;
}

/**
 * Pointer move: apply active drag.
 *
 * @param {PointerEvent} e - event
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
		view.value = { x0: drag.startView.x0 - dwx, x1: drag.startView.x1 - dwx, y0: drag.startView.y0 + dwy, y1: drag.startView.y1 + dwy };
		return;
	}

	const info = pointerInfo(e);

	if (drag.kind === "move") {
		const dwx = info.wx - drag.startWX;
		const dwy = info.wy - drag.startWY;
		setQuad(drag.id, drag.orig.map((p) => ({ x: p.x + dwx, y: p.y + dwy })));
		return;
	}

	if (drag.kind === "corner") {
		if (e.shiftKey) {
			const quad = drag.orig.map((p) => ({ ...p }));
			quad[drag.cornerIndex] = { x: info.wx, y: info.wy };
			setQuad(drag.id, quad);
		} else {
			const anchor = drag.orig[(drag.cornerIndex + 2) % 4];
			setQuad(drag.id, scaleQuadToPointer(drag.orig, anchor, drag.orig[drag.cornerIndex], info));
		}
		return;
	}

	if (drag.kind === "edge") {
		const ed = QUAD_EDGES[drag.edgeIndex];
		if (e.shiftKey) {
			const dwx = info.wx - drag.startWX;
			const dwy = info.wy - drag.startWY;
			const quad = drag.orig.map((p) => ({ ...p }));
			for (const v of ed.verts)
				quad[v] = { x: drag.orig[v].x + dwx, y: drag.orig[v].y + dwy };
			setQuad(drag.id, quad);
		} else {
			setQuad(drag.id, scaleQuadToPointer(drag.orig, midOf(drag.orig, ed.opp), midOf(drag.orig, ed.verts), info));
		}
		return;
	}

	if (drag.kind === "rotate") {
		const ang = Math.atan2(info.py - drag.cy, info.px - drag.cx) - drag.startAngle;
		const cos = Math.cos(ang);
		const sin = Math.sin(ang);
		const quad = drag.orig.map((p) => {
			const px = sx(p.x);
			const py = sy(p.y);
			const dx = px - drag.cx;
			const dy = py - drag.cy;
			return { x: ux(drag.cx + dx * cos - dy * sin), y: uy(drag.cy + dx * sin + dy * cos) };
		});
		setQuad(drag.id, quad);
	}
}

/**
 * Pointer up: release.
 *
 * @param {PointerEvent} e - event
 * @returns {void}
 */
function onPointerUp(e) {
	drag = null;
	if (svgEl.value && svgEl.value.hasPointerCapture(e.pointerId))
		svgEl.value.releasePointerCapture(e.pointerId);
}

/**
 * Wheel zoom around the cursor.
 *
 * @param {WheelEvent} e - event
 * @returns {void}
 */
function onWheel(e) {
	e.preventDefault();
	const info = pointerInfo(e);
	const v = view.value;
	const factor = e.deltaY > 0 ? 1.12 : 1 / 1.12;
	const clampR = (r) => Math.min(MAX_RANGE, Math.max(MIN_RANGE, r));
	const rx = clampR((v.x1 - v.x0) * factor);
	const ry = clampR((v.y1 - v.y0) * factor);
	view.value = {
		x0: info.wx - info.px / vw.value * rx,
		x1: info.wx - info.px / vw.value * rx + rx,
		y0: info.wy + info.py / vh.value * ry - ry,
		y1: info.wy + info.py / vh.value * ry
	};
}

/** Resets the canonical view. @returns {void} */
function viewHome() {
	view.value = { x0: 0, x1: 1, y0: -1, y1: 1 };
}

/** Frames all shapes + the 0..1/-1..1 box. @returns {void} */
function viewFit() {
	let minX = 0;
	let maxX = 1;
	let minY = -1;
	let maxY = 1;
	for (const s of shapes.value) {
		for (const c of s.quad) {
			minX = Math.min(minX, c.x);
			maxX = Math.max(maxX, c.x);
			minY = Math.min(minY, c.y);
			maxY = Math.max(maxY, c.y);
		}
	}
	const padX = (maxX - minX) * 0.08 + 0.03;
	const padY = (maxY - minY) * 0.08 + 0.05;
	view.value = { x0: minX - padX, x1: maxX + padX, y0: minY - padY, y1: maxY + padY };
}

onMounted(() => {
	const el = svgEl.value;
	const measure = () => {
		const r = el.getBoundingClientRect();
		if (r.width) vw.value = r.width;
		if (r.height) vh.value = r.height;
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

	<div class="shaper-editor">
		<div class="toolbar">
			<div class="palette">
				<button
					v-for="t in SHAPE_TYPES"
					:key="t"
					type="button"
					class="shape-btn material-symbols-outlined"
					:title="'Add ' + t"
					@click="addShape(t)"
				>{{ SHAPE_ICONS[t] }}</button>
			</div>

			<div v-if="selectedShape" class="sel-controls">
				<button type="button" :class="{ on: selectedShape.mode === 'add' }" @click="setMode('add')">add</button>
				<button type="button" :class="{ on: selectedShape.mode === 'subtract' }" @click="setMode('subtract')">subtract</button>
				<button type="button" class="del" title="Delete shape" @click="deleteSelected">×</button>
			</div>

			<div class="base">
				<label>base</label>
				<select :value="input ? input.sourceId : ''" @change="onInputChange">
					<option value="">Flat line</option>
					<option v-for="s in available" :key="s.id" :value="s.id">{{ s.name.value }}</option>
				</select>
				<template v-if="input">
					<span class="freq-label">freq</span>
					<JogWheel :model-value="input.frequency" :min="1" :max="32" :step="1" @update:model-value="setFreq" />
				</template>
			</div>

			<div class="view-tools">
				<button type="button" @click="viewFit" title="Frame all">Fit</button>
				<button type="button" @click="viewHome" title="Reset">1:1</button>
				<label class="shade-toggle"><input type="checkbox" v-model="showShade" /> Shade</label>
			</div>
		</div>

		<div class="canvas-wrap">
			<svg
				ref="svgEl"
				class="canvas"
				:viewBox="`0 0 ${vw} ${vh}`"
				preserveAspectRatio="none"
				@pointerdown="onPointerDown"
				@pointermove="onPointerMove"
				@pointerup="onPointerUp"
				@wheel="onWheel"
				@contextmenu.prevent
			>
				<rect x="0" y="0" :width="vw" :height="vh" class="bg" />
				<line :x1="sx(0)" y1="0" :x2="sx(0)" :y2="vh" class="boundary" />
				<line :x1="sx(1)" y1="0" :x2="sx(1)" :y2="vh" class="boundary" />
				<line x1="0" :y1="sy(0)" :x2="vw" :y2="sy(0)" class="axis" />

				<polyline v-for="k in ghostOffsets" :key="'g' + k" :points="profileToPoints(props.source.getCycle(), k)" class="ghost" fill="none" />

				<polygon v-if="showShade" :points="shadePoints" class="shade" />
				<polyline :points="basePoints" class="base-line" fill="none" />

				<!-- shapes -->
				<polygon
					v-for="s in shapes"
					:key="s.id"
					:points="shapePoints(s)"
					class="shape"
					:class="[s.mode, { selected: s.id === selectedId }]"
				/>

				<polyline :points="profilePoints" class="profile" fill="none" />

				<!-- selected shape handles -->
				<g v-if="selectedShape">
					<line
						:x1="(sx(selectedShape.quad[0].x) + sx(selectedShape.quad[1].x)) / 2"
						:y1="(sy(selectedShape.quad[0].y) + sy(selectedShape.quad[1].y)) / 2"
						:x2="rotateHandleScreen(selectedShape).x"
						:y2="rotateHandleScreen(selectedShape).y"
						class="rot-line"
					/>
					<circle :cx="rotateHandleScreen(selectedShape).x" :cy="rotateHandleScreen(selectedShape).y" r="6" class="rot-handle" />
					<circle v-for="(c, i) in selectedShape.quad" :key="i" :cx="sx(c.x)" :cy="sy(c.y)" r="6" class="corner" />
					<rect v-for="e in 4" :key="'e' + e" :x="edgeMidScreen(selectedShape.quad, e - 1).x - 4" :y="edgeMidScreen(selectedShape.quad, e - 1).y - 4" width="8" height="8" class="edge-handle" />
				</g>
			</svg>
		</div>
	</div>

</template>
<style lang="scss" scoped>

	.shaper-editor {
		display: flex;
		flex-direction: column;
		gap: 8px;
		flex: 1 1 auto;
		min-height: 280px;
	}

	.toolbar {
		display: flex;
		align-items: center;
		gap: 16px;
		flex-wrap: wrap;

		.palette { display: flex; gap: 4px; }

		.shape-btn {
			width: 30px;
			height: 28px;
			display: flex;
			align-items: center;
			justify-content: center;
			font-size: 18px;
			border: 1px solid #444;
			border-radius: 4px;
			background: #2a2a30;
			color: #ccc;
			cursor: pointer;
			&:hover { background: #34343c; color: #fff; }
		}

		.sel-controls {
			display: flex;
			gap: 4px;
			align-items: center;

			button {
				padding: 5px 9px;
				font-size: 12px;
				border: 1px solid #444;
				border-radius: 4px;
				background: #2a2a30;
				color: #ccc;
				cursor: pointer;
				&:hover { background: #34343c; }
				&.on { background: var(--accent-dim); color: var(--accent); border-color: var(--accent-border); }
				&.del:hover { background: rgba(255, 80, 80, 0.25); color: #fff; }
			}
		}

		.base {
			display: flex;
			align-items: center;
			gap: 6px;
			font-size: 11px;
			color: #999;

			select {
				background: #26262c;
				color: #ddd;
				border: 1px solid #444;
				border-radius: 4px;
				padding: 4px 6px;
			}
		}

		.view-tools {
			display: flex;
			align-items: center;
			gap: 4px;
			margin-left: auto;

			button {
				padding: 5px 9px;
				font-size: 12px;
				border: 1px solid #444;
				border-radius: 4px;
				background: #2a2a30;
				color: #ccc;
				cursor: pointer;
				&:hover { background: #34343c; }
			}

			.shade-toggle {
				display: flex;
				align-items: center;
				gap: 5px;
				font-size: 12px;
				color: #bbb;
				input { accent-color: var(--accent); }
			}
		}
	}

	.canvas-wrap {
		flex: 1 1 auto;
		min-height: 240px;
		background: #0a0a0c;
		border: 1px solid #2c2c32;
		border-radius: 6px;
		overflow: hidden;
	}

	.canvas { display: block; width: 100%; height: 100%; touch-action: none; cursor: default; }

	.bg { fill: transparent; }
	.axis, .boundary, .shade, .base-line, .profile, .ghost, .shape, .rot-line, .rot-handle, .corner, .edge-handle { pointer-events: none; }

	.axis { stroke: rgba(255, 255, 255, 0.14); stroke-width: 1; }
	.boundary { stroke: rgba(255, 255, 255, 0.08); stroke-width: 1; }
	.shade { fill: var(--accent-dim); }
	.base-line { stroke: rgba(255, 255, 255, 0.25); stroke-width: 1; stroke-dasharray: 3 3; }
	.profile { stroke: #ff4d4d; stroke-width: 2; }
	.ghost { stroke: rgba(255, 77, 77, 0.28); stroke-width: 1.5; stroke-dasharray: 4 4; }

	.shape {
		stroke-width: 1.5;
		fill: rgba(0, 171, 174, 0.10);
		stroke: var(--accent);
		&.subtract { fill: rgba(255, 77, 77, 0.10); stroke: #ff4d4d; }
		&.selected { stroke-width: 2.5; }
	}

	.rot-line { stroke: #9a9a9a; stroke-width: 1; }
	.rot-handle { fill: #2a2a30; stroke: var(--accent); stroke-width: 2; }
	.corner { fill: #fff; stroke: var(--accent); stroke-width: 2; }
	.edge-handle { fill: #2a2a30; stroke: var(--accent); stroke-width: 2; }

</style>
