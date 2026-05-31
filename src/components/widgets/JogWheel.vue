<!--
	JogWheel.vue
	-----------

	An infinite relative rotary control: click-drag (vertically) to nudge a value
	up/down by step. It has no hard end-stops — the face keeps spinning as you
	drag — though the emitted value is clamped to [min, max]. Good for stepping
	integer parameters like frequency.
-->
<script setup>

// vue
import { ref, watch } from "vue";

const props = defineProps({
	modelValue: { type: Number, default: 1 },
	min: { type: Number, default: -Infinity },
	max: { type: Number, default: Infinity },
	step: { type: Number, default: 1 },
	sensitivity: { type: Number, default: 7 },
	size: { type: Number, default: 30 }
});

const emit = defineEmits(["update:modelValue"]);

// visual rotation (accumulates freely) and a local value mirror
const rotation = ref(0);
const val = ref(props.modelValue);
watch(() => props.modelValue, (v) => { val.value = v; });

let dragging = false;
let lastY = 0;
let acc = 0;

/**
 * Clamps to the configured range.
 *
 * @param {Number} v - value
 * @returns {Number}
 */
function clamp(v) {
	return Math.min(props.max, Math.max(props.min, v));
}

/**
 * @param {PointerEvent} e - pointer down
 * @returns {void}
 */
function onDown(e) {
	e.preventDefault();
	dragging = true;
	lastY = e.clientY;
	acc = 0;
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
	rotation.value += dy * 1.8;
	acc += dy;
	const steps = Math.trunc(acc / props.sensitivity);
	if (steps !== 0) {
		acc -= steps * props.sensitivity;
		const nv = clamp(val.value + steps * props.step);
		if (nv !== val.value) {
			val.value = nv;
			emit("update:modelValue", nv);
		}
	}
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

</script>
<template>
	<div
		class="jog"
		:style="{ width: size + 'px', height: size + 'px' }"
		title="Drag to adjust"
		@pointerdown="onDown"
		@pointermove="onMove"
		@pointerup="onUp"
	>
		<div class="face" :style="{ transform: `rotate(${rotation}deg)` }">
			<span class="notch"></span>
		</div>
	</div>
</template>
<style scoped>

	.jog {
		position: relative;
		border-radius: 50%;
		cursor: ns-resize;
		background: radial-gradient(circle at 50% 35%, #4a4a52, #232327 70%);
		box-shadow: 0 1px 2px rgba(0, 0, 0, 0.6), inset 0 1px 1px rgba(255, 255, 255, 0.12), inset 0 -2px 3px rgba(0, 0, 0, 0.5);
		border: 1px solid #1c1c20;
		touch-action: none;
		flex: 0 0 auto;
	}

	.jog::after {
		content: "";
		position: absolute;
		inset: 3px;
		border-radius: 50%;
		border: 1px dashed rgba(255, 255, 255, 0.08);
		pointer-events: none;
	}

	.face { position: absolute; inset: 0; }

	.notch {
		position: absolute;
		left: 50%;
		top: 4px;
		width: 2px;
		height: 35%;
		margin-left: -1px;
		background: var(--accent);
		border-radius: 1px;
		box-shadow: 0 0 3px var(--accent);
	}

</style>
