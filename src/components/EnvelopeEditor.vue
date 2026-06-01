<!--
	EnvelopeEditor.vue
	------------------

	Draws the synth's amplitude envelope as a bezier curve in [0,1] x [0,1]
	(x = progress, y = level). A draggable vertical "split" marks the sustain
	point: left of it is the attack/decay shape, the level there is held while a
	key is down, and right of it is the release shape. Two knobs set how long the
	pre-split and release segments take in seconds (shape vs. speed are separate).

	Reuses curveTools for the bezier editing math. Interactions:
	  - drag an anchor to move it (endpoints are x-locked to 0 and 1);
	  - drag a handle to reshape (smooth);
	  - shift-drag an anchor to pull out / adjust its handles;
	  - double-click the curve to add a point, double-click a point to remove it;
	  - drag the dashed split line to set the sustain point.
-->
<script setup>

// vue
import { inject, computed, ref, onMounted, onBeforeUnmount } from "vue";

// bezier projection for click-on-curve
import { Bezier } from "bezier-js";

// pure edit helpers (shared with the wave curve editor)
import { splitInsert, deleteAnchor, applyHandleDrag, segmentPoints } from "@/classes/curveTools.js";

// reusable knob widget
import Knob from "@/components/widgets/Knob.vue";

// shared app state -> the synth-wide envelope
const app = inject("app");
const env = app.envelope;

// hit thresholds (px) + drag threshold
const ANCHOR_HIT = 12;
const HANDLE_HIT = 11;
const PATH_HIT = 12;
const SPLIT_HIT = 8;
const DRAG_THRESHOLD = 4;

// inner padding (px) so y=0 / y=1 anchors aren't clipped
const PAD_X = 8;
const PAD_Y = 10;

// element pixel size (kept in sync via ResizeObserver)
const vw = ref(600);
const vh = ref(200);

const svgEl = ref(null);
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
 * Clones an anchor list.
 *
 * @param {Array<Object>} anchors - anchors
 * @returns {Array<Object>}
 */
function cloneAnchors(anchors) {
	return anchors.map((a) => ({ ...a }));
}

// reactive envelope state
const anchors = computed(() => env.getAnchors());
const samples = computed(() => env.sample(256));
const splitIdx = computed(() => clamp(Math.round(env.split.value * 255), 0, 255));
const sustain = computed(() => samples.value[splitIdx.value]);

/**
 * Wave x -> pixel x.
 *
 * @param {Number} x - 0..1
 * @returns {Number}
 */
function sx(x) {
	return PAD_X + x * (vw.value - 2 * PAD_X);
}

/**
 * Wave y (level) -> pixel y (0 at bottom, 1 at top).
 *
 * @param {Number} y - 0..1
 * @returns {Number}
 */
function sy(y) {
	return (vh.value - PAD_Y) - y * (vh.value - 2 * PAD_Y);
}

/**
 * Pointer position in pixels and wave coords.
 *
 * @param {PointerEvent} e - event
 * @returns {{ px:Number, py:Number, wx:Number, wy:Number }}
 */
function pointerInfo(e) {
	const r = svgEl.value.getBoundingClientRect();
	const px = e.clientX - r.left;
	const py = e.clientY - r.top;
	return {
		px,
		py,
		wx: clamp((px - PAD_X) / (r.width - 2 * PAD_X), 0, 1),
		wy: clamp(((r.height - PAD_Y) - py) / (r.height - 2 * PAD_Y), 0, 1)
	};
}

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
 * Finds the anchor under the pointer, or -1.
 *
 * @param {Number} px - pixel x
 * @param {Number} py - pixel y
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
 * @param {Number} px - pixel x
 * @param {Number} py - pixel y
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
 * Projects the pointer onto the curve, returning nearest segment + t.
 *
 * @param {Number} px - pixel x
 * @param {Number} py - pixel y
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
 * Commits a new anchor list to the envelope.
 *
 * @param {Array<Object>} next - new anchors
 * @returns {void}
 */
function commit(next) {
	env.setAnchors(next);
}

/**
 * Pulls fresh symmetric handles out of an anchor (shift-drag). Endpoints get
 * only their one valid handle (first: out, last: in).
 *
 * @param {Object} anchor - anchor (mutated)
 * @param {Number} index - anchor index
 * @param {Number} last - last index
 * @param {Number} dx - x offset (anchor-local)
 * @param {Number} dy - y offset (anchor-local)
 * @returns {void}
 */
function applyDragOut(anchor, index, last, dx, dy) {
	anchor.isBroken = false;
	if (index === 0) {
		anchor.handleOutX = dx;
		anchor.handleOutY = dy;
	} else if (index === last) {
		anchor.handleInX = dx;
		anchor.handleInY = dy;
	} else {
		anchor.handleOutX = dx;
		anchor.handleOutY = dy;
		anchor.handleInX = -dx;
		anchor.handleInY = -dy;
	}
}

/**
 * Builds the cubic design path.
 *
 * @returns {String}
 */
const designPath = computed(() => {
	const a = anchors.value;
	if (!a || a.length < 2)
		return "";
	let d = `M ${sx(a[0].x).toFixed(2)} ${sy(a[0].y).toFixed(2)}`;
	for (let i = 0; i < a.length - 1; i++) {
		const { p1, p2, p3 } = segmentPoints(a, i);
		d += ` C ${sx(p1.x).toFixed(2)} ${sy(p1.y).toFixed(2)} ${sx(p2.x).toFixed(2)} ${sy(p2.y).toFixed(2)} ${sx(p3.x).toFixed(2)} ${sy(p3.y).toFixed(2)}`;
	}
	return d;
});

/**
 * The sampled (played) profile as a polyline + a closed fill area.
 */
const profilePoints = computed(() => {
	const s = samples.value;
	const n = s.length;
	const step = Math.max(1, Math.floor(n / 400));
	let pts = "";
	for (let i = 0; i < n; i += step)
		pts += `${sx(i / (n - 1)).toFixed(2)},${sy(s[i]).toFixed(2)} `;
	return pts.trim();
});

const fillPoints = computed(() => `${sx(0).toFixed(2)},${sy(0).toFixed(2)} ${profilePoints.value} ${sx(1).toFixed(2)},${sy(0).toFixed(2)}`);

/**
 * Pointer-down: hit-test handle / anchor / split and start a drag.
 *
 * @param {PointerEvent} e - event
 * @returns {void}
 */
function onPointerDown(e) {

	if (e.button !== 0)
		return;

	svgEl.value.setPointerCapture(e.pointerId);
	e.preventDefault();

	const info = pointerInfo(e);
	const a = anchors.value;
	const base = { startWX: info.wx, startWY: info.wy, startSX: e.clientX, startSY: e.clientY, moved: false, orig: cloneAnchors(a) };

	const handle = hitHandle(info.px, info.py);
	if (handle) {
		drag = { ...base, kind: "handle", index: handle.index, which: handle.which, anchorX: a[handle.index].x, anchorY: a[handle.index].y };
		return;
	}

	const ai = hitAnchor(info.px, info.py);
	if (ai >= 0) {
		drag = { ...base, kind: e.shiftKey ? "dragOut" : "anchorMove", index: ai, anchorX: a[ai].x, anchorY: a[ai].y };
		return;
	}

	if (Math.abs(info.px - sx(env.split.value)) < SPLIT_HIT) {
		drag = { ...base, kind: "split" };
		return;
	}

	drag = null;
}

/**
 * Pointer-move: applies the active drag.
 *
 * @param {PointerEvent} e - event
 * @returns {void}
 */
function onPointerMove(e) {

	if (!drag)
		return;

	const info = pointerInfo(e);

	if (drag.kind === "split") {
		env.setSplit(info.wx);
		return;
	}

	if (!drag.moved && Math.hypot(e.clientX - drag.startSX, e.clientY - drag.startSY) > DRAG_THRESHOLD)
		drag.moved = true;
	if (!drag.moved)
		return;

	const last = drag.orig.length - 1;

	if (drag.kind === "anchorMove") {
		const next = cloneAnchors(drag.orig);
		next[drag.index].x = drag.index === 0 ? 0 : drag.index === last ? 1 : clamp(info.wx, 0, 1);
		next[drag.index].y = clamp(info.wy, 0, 1);
		commit(next);
		return;
	}

	if (drag.kind === "handle") {
		const next = cloneAnchors(drag.orig);
		applyHandleDrag(next[drag.index], drag.which, info.wx - drag.anchorX, info.wy - drag.anchorY);
		commit(next);
		return;
	}

	if (drag.kind === "dragOut") {
		const next = cloneAnchors(drag.orig);
		applyDragOut(next[drag.index], drag.index, last, info.wx - drag.anchorX, info.wy - drag.anchorY);
		commit(next);
	}
}

/**
 * Pointer-up: releases capture and saves.
 *
 * @param {PointerEvent} e - event
 * @returns {void}
 */
function onPointerUp(e) {
	drag = null;
	if (svgEl.value && svgEl.value.hasPointerCapture(e.pointerId))
		svgEl.value.releasePointerCapture(e.pointerId);
	app.requestSave();
}

/**
 * Double-click: delete an interior anchor, or insert one on the curve.
 *
 * @param {MouseEvent} e - event
 * @returns {void}
 */
function onDblClick(e) {
	const info = pointerInfo(e);
	const a = anchors.value;
	const ai = hitAnchor(info.px, info.py);
	if (ai > 0 && ai < a.length - 1) {
		commit(deleteAnchor(a, ai));
		app.requestSave();
		return;
	}
	const path = hitPath(info.px, info.py);
	if (path) {
		commit(splitInsert(a, path.segIndex, path.t).anchors);
		app.requestSave();
	}
}

/**
 * Attack-time knob handler.
 *
 * @param {Number} v - seconds
 * @returns {void}
 */
function onAttack(v) {
	env.setAttackTime(v);
	app.requestSave();
}

/**
 * Release-time knob handler.
 *
 * @param {Number} v - seconds
 * @returns {void}
 */
function onRelease(v) {
	env.setReleaseTime(v);
	app.requestSave();
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

	<div class="envelope-editor">

		<div class="controls">
			<div class="knob">
				<span class="klabel">Attack</span>
				<Knob :model-value="env.attackTime.value" :min="0.005" :max="4" :curve="3" @update:model-value="onAttack" />
				<span class="kval">{{ env.attackTime.value.toFixed(3) }}s</span>
			</div>
			<div class="knob">
				<span class="klabel">Release</span>
				<Knob :model-value="env.releaseTime.value" :min="0.005" :max="4" :curve="3" @update:model-value="onRelease" />
				<span class="kval">{{ env.releaseTime.value.toFixed(3) }}s</span>
			</div>
			<div class="readout">
				<span>Sustain <strong>{{ sustain.toFixed(2) }}</strong></span>
				<span>Split <strong>{{ env.split.value.toFixed(2) }}</strong></span>
			</div>
			<span class="hint">Drag points/handles · shift-drag a point for handles · dbl-click to add/remove · drag the dashed line to set sustain</span>
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
				@dblclick="onDblClick"
				@contextmenu.prevent
			>
				<rect x="0" y="0" :width="vw" :height="vh" class="bg" />

				<!-- baseline (level 0) + top (level 1) -->
				<line x1="0" :y1="sy(0)" :x2="vw" :y2="sy(0)" class="axis" />
				<line x1="0" :y1="sy(1)" :x2="vw" :y2="sy(1)" class="axis faint" />

				<!-- played profile fill + line -->
				<polygon :points="fillPoints" class="fill" />
				<polyline :points="profilePoints" class="profile" fill="none" />

				<!-- design curve -->
				<path :d="designPath" class="design" fill="none" />

				<!-- handles -->
				<g v-for="(a, i) in anchors" :key="'h' + i">
					<g v-for="(h, hi) in handlesFor(a, i)" :key="hi">
						<line :x1="sx(a.x)" :y1="sy(a.y)" :x2="sx(h.wx)" :y2="sy(h.wy)" class="handle-line" />
						<circle :cx="sx(h.wx)" :cy="sy(h.wy)" r="5" class="handle-dot" />
					</g>
				</g>

				<!-- anchors -->
				<circle v-for="(a, i) in anchors" :key="'a' + i" :cx="sx(a.x)" :cy="sy(a.y)" r="6" class="anchor" />

				<!-- sustain split line + level dot -->
				<line :x1="sx(env.split.value)" y1="0" :x2="sx(env.split.value)" :y2="vh" class="split" />
				<circle :cx="sx(env.split.value)" :cy="sy(sustain)" r="5" class="sustain-dot" />
			</svg>
		</div>

	</div>

</template>
<style lang="scss" scoped>

	.envelope-editor {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.controls {
		display: flex;
		align-items: center;
		gap: 18px;
		flex-wrap: wrap;

		.knob {
			display: flex;
			align-items: center;
			gap: 8px;

			.klabel {
				font-size: 11px;
				text-transform: uppercase;
				letter-spacing: 0.06em;
				color: #999;
			}

			.kval {
				font-size: 12px;
				color: #ccc;
				font-variant-numeric: tabular-nums;
				min-width: 48px;
			}
		}

		.readout {
			display: flex;
			gap: 14px;
			font-size: 12px;
			color: #aaa;

			strong { color: var(--accent); }
		}

		.hint { font-size: 11px; color: #666; flex: 1 1 200px; }
	}

	.canvas-wrap {
		height: 200px;
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
		cursor: crosshair;
	}

	.bg { fill: transparent; }
	.axis, .fill, .profile, .design, .handle-line, .handle-dot, .anchor, .split, .sustain-dot { pointer-events: none; }

	.axis { stroke: rgba(255, 255, 255, 0.14); stroke-width: 1; }
	.axis.faint { stroke: rgba(255, 255, 255, 0.06); }
	.fill { fill: var(--accent-dim); }
	.profile { stroke: var(--accent); stroke-width: 2; }
	.design { stroke: #cccccc; stroke-width: 1.4; opacity: 0.55; }
	.handle-line { stroke: #7a7a7a; stroke-width: 1; }
	.handle-dot { fill: #2a2a30; stroke: #9a9a9a; stroke-width: 1.5; }

	.anchor {
		fill: var(--accent);
		stroke: #04302f;
		stroke-width: 1.5;
	}

	.split { stroke: #e0b34d; stroke-width: 1.5; stroke-dasharray: 5 4; }
	.sustain-dot { fill: #e0b34d; stroke: #1b1b1f; stroke-width: 1.5; }

</style>
