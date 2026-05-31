<!--
	CurveEditor.vue
	---------------

	Renders a CustomWave's bezier curve. Phase 3a is read-only: it draws the
	black design curve (which may fold back on itself), the red "true profile"
	line (the upper silhouette = exactly what plays), the anchors and handles,
	and an optional shaded fill under the profile. The pen / selection / anchor
	editing tools arrive in Phase 3b.

	Coordinate mapping: x 0..1 -> 0..W; y -1..1 -> H..0 (y is flipped so +1 is up).
-->
<script setup>

// vue
import { computed, ref } from "vue";

const props = defineProps({
	// a CustomWave instance
	source: { type: Object, required: true }
});

// drawing space (stretched to fill via preserveAspectRatio="none")
const W = 1000;
const H = 400;

// show the shaded fill under the profile
const showShade = ref(true);

/**
 * Maps a normalized x (0-1) to drawing space.
 *
 * @param {Number} x - normalized x
 * @returns {Number}
 */
function mapX(x) {
	return x * W;
}

/**
 * Maps a normalized y (-1..1) to drawing space (flipped).
 *
 * @param {Number} y - normalized y
 * @returns {Number}
 */
function mapY(y) {
	return (1 - y) / 2 * H;
}

// the anchors (reactive)
const anchors = computed(() => props.source.getAnchors());

/**
 * The black design path: a cubic between each pair of anchors using their
 * out/in handle offsets as control points.
 *
 * @returns {String}
 */
const designPath = computed(() => {
	const a = anchors.value;
	if (!a || a.length < 2)
		return "";
	let d = `M ${mapX(a[0].x).toFixed(2)} ${mapY(a[0].y).toFixed(2)}`;
	for (let i = 0; i < a.length - 1; i++) {
		const p = a[i];
		const q = a[i + 1];
		const c1x = mapX(p.x + (p.handleOutX || 0));
		const c1y = mapY(p.y + (p.handleOutY || 0));
		const c2x = mapX(q.x + (q.handleInX || 0));
		const c2y = mapY(q.y + (q.handleInY || 0));
		d += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)} ${c2x.toFixed(2)} ${c2y.toFixed(2)} ${mapX(q.x).toFixed(2)} ${mapY(q.y).toFixed(2)}`;
	}
	return d;
});

/**
 * The red true-profile polyline points (downsampled from the audible cycle).
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
 * Polygon points for the shaded fill: the profile, closed down to the bottom.
 *
 * @returns {String}
 */
const shadePoints = computed(() => `0,${H} ${profilePoints.value} ${W},${H}`);

/**
 * Handle endpoints to draw for an anchor (skips zero-length / endpoint handles).
 *
 * @param {Object} a - anchor
 * @param {Number} index - anchor index
 * @returns {Array<{x:Number,y:Number}>}
 */
function handlesFor(a, index) {
	const list = [];
	const last = anchors.value.length - 1;
	if (index > 0 && (a.handleInX || a.handleInY))
		list.push({ x: mapX(a.x + a.handleInX), y: mapY(a.y + a.handleInY) });
	if (index < last && (a.handleOutX || a.handleOutY))
		list.push({ x: mapX(a.x + a.handleOutX), y: mapY(a.y + a.handleOutY) });
	return list;
}

</script>
<template>

	<div class="curve-editor">
		<div class="toolbar">
			<label class="shade-toggle">
				<input type="checkbox" v-model="showShade" /> Shade profile
			</label>
			<span class="hint">Read-only preview — editing tools in Phase 3b</span>
		</div>

		<div class="canvas-wrap">
			<svg class="canvas" :viewBox="`0 0 ${W} ${H}`" preserveAspectRatio="none">
				<!-- center line -->
				<line x1="0" :y1="H / 2" :x2="W" :y2="H / 2" class="axis" />

				<!-- shaded true-profile area -->
				<polygon v-if="showShade" :points="shadePoints" class="shade" />

				<!-- black design curve -->
				<path :d="designPath" class="design" fill="none" />

				<!-- red true-profile line -->
				<polyline :points="profilePoints" class="profile" fill="none" />

				<!-- handles -->
				<g v-for="(a, i) in anchors" :key="'h' + i">
					<g v-for="(h, hi) in handlesFor(a, i)" :key="hi">
						<line :x1="mapX(a.x)" :y1="mapY(a.y)" :x2="h.x" :y2="h.y" class="handle-line" />
						<circle :cx="h.x" :cy="h.y" r="5" class="handle-dot" />
					</g>
				</g>

				<!-- anchors -->
				<circle v-for="(a, i) in anchors" :key="'a' + i" :cx="mapX(a.x)" :cy="mapY(a.y)" r="6" class="anchor" />
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
		min-height: 240px;
	}

	.toolbar {
		display: flex;
		align-items: center;
		gap: 14px;
		flex: 0 0 auto;

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
		min-height: 200px;
		background: #0a0a0c;
		border: 1px solid #2c2c32;
		border-radius: 6px;
		overflow: hidden;
	}

	.canvas {
		display: block;
		width: 100%;
		height: 100%;
	}

	.axis {
		stroke: rgba(255, 255, 255, 0.12);
		stroke-width: 1;
		vector-effect: non-scaling-stroke;
	}

	.shade {
		fill: var(--accent-dim);
	}

	.design {
		stroke: #cccccc;
		stroke-width: 1.5;
		vector-effect: non-scaling-stroke;
	}

	.profile {
		stroke: #ff4d4d;
		stroke-width: 2;
		vector-effect: non-scaling-stroke;
	}

	.handle-line {
		stroke: #7a7a7a;
		stroke-width: 1;
		vector-effect: non-scaling-stroke;
	}

	.handle-dot {
		fill: #2a2a30;
		stroke: #9a9a9a;
		stroke-width: 1.5;
		vector-effect: non-scaling-stroke;
	}

	.anchor {
		fill: var(--accent);
		stroke: #04302f;
		stroke-width: 1.5;
		vector-effect: non-scaling-stroke;
	}

</style>
