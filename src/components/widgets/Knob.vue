<!--
	Knob.vue
	--------

	A bounded rotary knob with an exponential value curve, so the low end of the
	range gets most of the travel (fine control near 0) while still reaching a
	higher max. Drag vertically to adjust; shows a numeric readout.
-->
<script setup>

// vue
import { ref, watch, computed } from "vue";

const props = defineProps({
	modelValue: { type: Number, default: 1 },
	min: { type: Number, default: 0 },
	max: { type: Number, default: 4 },
	curve: { type: Number, default: 2.5 },
	size: { type: Number, default: 34 }
});

const emit = defineEmits(["update:modelValue"]);

const DRAG_RANGE = 150;

/**
 * value -> normalized knob travel (0-1), expanding the low end.
 *
 * @param {Number} v - value
 * @returns {Number}
 */
function valueToNorm(v) {
	const t = (v - props.min) / (props.max - props.min);
	return Math.max(0, Math.min(1, Math.pow(Math.max(0, t), 1 / props.curve)));
}

/**
 * normalized knob travel -> value.
 *
 * @param {Number} nrm - travel 0-1
 * @returns {Number}
 */
function normToValue(nrm) {
	return props.min + (props.max - props.min) * Math.pow(nrm, props.curve);
}

const norm = ref(valueToNorm(props.modelValue));
watch(() => props.modelValue, (v) => { norm.value = valueToNorm(v); });

let dragging = false;
let lastY = 0;

/**
 * @param {PointerEvent} e - pointer down
 * @returns {void}
 */
function onDown(e) {
	e.preventDefault();
	dragging = true;
	lastY = e.clientY;
	e.currentTarget.setPointerCapture(e.pointerId);
}

/**
 * @param {PointerEvent} e - pointer move
 * @returns {void}
 */
function onMove(e) {
	if (!dragging)
		return;
	const dy = lastY - e.clientY;
	lastY = e.clientY;
	norm.value = Math.max(0, Math.min(1, norm.value + dy / DRAG_RANGE));
	emit("update:modelValue", normToValue(norm.value));
}

/**
 * @param {PointerEvent} e - pointer up
 * @returns {void}
 */
function onUp(e) {
	dragging = false;
	if (e.currentTarget.hasPointerCapture && e.currentTarget.hasPointerCapture(e.pointerId))
		e.currentTarget.releasePointerCapture(e.pointerId);
}

const angle = computed(() => -135 + norm.value * 270);
const display = computed(() => normToValue(norm.value).toFixed(2));

</script>
<template>
	<div class="knob-wrap">
		<div
			class="knob"
			:style="{ width: size + 'px', height: size + 'px' }"
			:title="display"
			@pointerdown="onDown"
			@pointermove="onMove"
			@pointerup="onUp"
		>
			<div class="ind" :style="{ transform: `rotate(${angle}deg)` }"><span></span></div>
		</div>
		<span class="readout">{{ display }}</span>
	</div>
</template>
<style scoped>

	.knob-wrap { display: flex; flex-direction: column; align-items: center; gap: 2px; }

	.knob {
		position: relative;
		border-radius: 50%;
		cursor: ns-resize;
		background: radial-gradient(circle at 50% 30%, #52525a, #26262b 72%);
		box-shadow: 0 1px 2px rgba(0, 0, 0, 0.6), inset 0 1px 1px rgba(255, 255, 255, 0.15), inset 0 -3px 4px rgba(0, 0, 0, 0.55);
		border: 1px solid #1b1b1f;
		touch-action: none;
	}

	.ind { position: absolute; inset: 0; }

	.ind span {
		position: absolute;
		left: 50%;
		top: 3px;
		width: 2px;
		height: 42%;
		margin-left: -1px;
		background: var(--accent);
		border-radius: 1px;
		box-shadow: 0 0 3px var(--accent);
	}

	.readout { font-size: 10px; color: #aaa; font-variant-numeric: tabular-nums; }

</style>
