<!--
	BlendMatrix.vue
	---------------

	A grid of mutually-exclusive options (radio-like). The selected option looks
	pressed in (inset shadow); the rest look raised/beveled to imply they're
	clickable. Shows all blend modes at once.
-->
<script setup>

const props = defineProps({
	modelValue: { type: String, default: "" },
	options: { type: Array, default: () => [] }
});

const emit = defineEmits(["update:modelValue"]);

// compact symbols for the arithmetic modes
const SYMBOLS = { add: "+", subtract: "−", multiply: "×", divide: "÷", max: "max", min: "min" };

/**
 * Display glyph for an option.
 *
 * @param {String} o - option
 * @returns {String}
 */
function sym(o) {
	return SYMBOLS[o] || o;
}

</script>
<template>
	<div class="blend-matrix">
		<button
			v-for="o in options"
			:key="o"
			type="button"
			class="cell"
			:class="{ on: o === modelValue }"
			:title="o"
			@click="emit('update:modelValue', o)"
		>{{ sym(o) }}</button>
	</div>
</template>
<style scoped>

	.blend-matrix {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 3px;
	}

	.cell {
		min-width: 30px;
		height: 24px;
		font-size: 12px;
		border-radius: 4px;
		border: 1px solid #15151a;
		color: #cfcfcf;
		cursor: pointer;
		background: linear-gradient(#3a3a42, #2a2a30);
		box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08), 0 2px 3px rgba(0, 0, 0, 0.5);
		transition: filter 0.08s;
	}

	.cell:hover { filter: brightness(1.12); }

	.cell.on {
		color: var(--accent);
		background: linear-gradient(#202024, #2a2a30);
		box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.7), inset 0 -1px 0 rgba(255, 255, 255, 0.05);
		border-color: var(--accent-border);
	}

</style>
