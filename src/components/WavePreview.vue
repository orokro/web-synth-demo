<!--
	WavePreview.vue
	---------------

	Tiny read-only SVG rendering of one cycle of samples, centered vertically.
	Reused for source thumbnails and editor previews. Stretches to fill its box;
	the stroke stays a uniform width via non-scaling-stroke. Stroke color is set
	through inline style (which resolves CSS vars) and defaults to the app accent.
-->
<script setup>

// vue
import { computed } from "vue";

const props = defineProps({
	// Float32Array of one cycle, values in [-1, 1]
	samples: { type: Object, default: null },
	// stroke color (any CSS color, including a var()); defaults to the accent
	stroke: { type: String, default: "var(--accent)" },
	// target number of drawn points (samples are downsampled to this)
	points: { type: Number, default: 256 }
});

const VIEW_W = 100;
const VIEW_H = 40;

/**
 * Builds an SVG path string from the samples, downsampled to ~points.
 *
 * @returns {String}
 */
const path = computed(() => {

	const s = props.samples;
	if (!s || s.length === 0)
		return "";

	const n = s.length;
	const step = Math.max(1, Math.floor(n / props.points));

	let d = "";
	let first = true;

	for (let i = 0; i < n; i += step) {
		const x = (i / (n - 1)) * VIEW_W;
		const y = (1 - (s[i] + 1) / 2) * VIEW_H;
		d += (first ? "M" : "L") + x.toFixed(2) + " " + y.toFixed(2) + " ";
		first = false;
	}

	return d.trim();
});

</script>
<template>

	<svg class="wave-preview" viewBox="0 0 100 40" preserveAspectRatio="none">
		<line x1="0" y1="20" x2="100" y2="20" class="axis" />
		<path :d="path" :style="{ stroke }" fill="none" />
	</svg>

</template>
<style scoped>

	.wave-preview {
		display: block;
		width: 100%;
		height: 100%;
	}

	.wave-preview .axis {
		stroke: rgba(255, 255, 255, 0.12);
		stroke-width: 1;
		vector-effect: non-scaling-stroke;
	}

	.wave-preview path {
		stroke-width: 2;
		vector-effect: non-scaling-stroke;
	}

</style>
