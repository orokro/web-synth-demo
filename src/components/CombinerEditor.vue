<!--
	CombinerEditor.vue
	------------------

	Editor for a CombinedWave: a stack of input sources, each with its own
	frequency, amplitude (scale) and blend mode. The first input is the base;
	later inputs blend onto it. Inputs reference other sources by id, so editing
	a referenced source updates this one live. The add-input list is filtered so
	you can only pick sources that won't create a reference cycle.

	The combined output preview is the EditorWindow's wave preview above; this
	component manages the input list.
-->
<script setup>

// vue
import { inject, computed } from "vue";

// components
import WavePreview from "@/components/WavePreview.vue";

// blend modes
import { BLEND_MODES } from "@/classes/sources/CombinedWave.js";

const props = defineProps({
	// a CombinedWave instance
	source: { type: Object, required: true }
});

// shared app state
const app = inject("app");

// current inputs (reactive)
const inputs = computed(() => props.source.getInputs());

// sources that can be added without creating a cycle (also excludes self)
const available = computed(() => app.sources.value.filter((s) => app.canReference(props.source.id, s.id)));

/**
 * Adds an input referencing the given source.
 *
 * @param {String} sourceId - source id to add
 * @returns {void}
 */
function addInput(sourceId) {
	if (!sourceId || !app.canReference(props.source.id, sourceId))
		return;
	props.source.setInputs([...inputs.value, { sourceId, frequency: 1, scale: 1, blendMode: "add" }]);
}

/**
 * Handles the add-input select.
 *
 * @param {Event} event - change event
 * @returns {void}
 */
function onAddSelect(event) {
	addInput(event.target.value);
	event.target.value = "";
}

/**
 * Removes an input by index.
 *
 * @param {Number} index - input index
 * @returns {void}
 */
function removeInput(index) {
	props.source.setInputs(inputs.value.filter((_, i) => i !== index));
}

/**
 * Moves an input up or down.
 *
 * @param {Number} index - input index
 * @param {Number} dir - -1 up, +1 down
 * @returns {void}
 */
function moveInput(index, dir) {
	const arr = inputs.value.slice();
	const j = index + dir;
	if (j < 0 || j >= arr.length)
		return;
	const tmp = arr[index];
	arr[index] = arr[j];
	arr[j] = tmp;
	props.source.setInputs(arr);
}

/**
 * Patches one field of an input.
 *
 * @param {Number} index - input index
 * @param {String} key - field name
 * @param {*} value - new value
 * @returns {void}
 */
function updateInput(index, key, value) {
	props.source.setInputs(inputs.value.map((inp, i) => (i === index ? { ...inp, [key]: value } : inp)));
}

/**
 * Resolves the source an input references.
 *
 * @param {Object} input - input descriptor
 * @returns {Object|null}
 */
function inputSource(input) {
	return app.getSource(input.sourceId);
}

</script>
<template>

	<div class="combiner-editor">
		<div class="toolbar">
			<select class="add-input" @change="onAddSelect">
				<option value="">+ Add input…</option>
				<option v-for="s in available" :key="s.id" :value="s.id">{{ s.name.value }}</option>
			</select>
			<span class="hint">First input is the base; others blend onto it. Scale to avoid clipping.</span>
		</div>

		<div class="inputs">
			<p v-if="inputs.length === 0" class="empty">No inputs yet — add one above.</p>

			<div v-for="(inp, i) in inputs" :key="i" class="input-row">
				<div class="reorder">
					<button type="button" :disabled="i === 0" title="Move up" @click="moveInput(i, -1)">▲</button>
					<button type="button" :disabled="i === inputs.length - 1" title="Move down" @click="moveInput(i, 1)">▼</button>
				</div>

				<span class="thumb">
					<WavePreview v-if="inputSource(inp)" :samples="inputSource(inp).getCycle()" />
					<span v-else class="missing">missing</span>
				</span>

				<div class="meta">
					<span class="name">{{ inputSource(inp) ? inputSource(inp).name.value : "(deleted source)" }}</span>
					<div class="params">
						<label>freq
							<input type="number" min="1" max="32" step="1" :value="inp.frequency" @input="updateInput(i, 'frequency', Math.max(1, parseInt($event.target.value) || 1))" />
						</label>
						<label>scale
							<input type="number" min="-2" max="2" step="0.05" :value="inp.scale" @input="updateInput(i, 'scale', parseFloat($event.target.value))" />
						</label>
						<label v-if="i > 0">blend
							<select :value="inp.blendMode" @change="updateInput(i, 'blendMode', $event.target.value)">
								<option v-for="m in BLEND_MODES" :key="m" :value="m">{{ m }}</option>
							</select>
						</label>
						<span v-else class="base-tag">base</span>
					</div>
				</div>

				<button class="del" type="button" title="Remove input" @click="removeInput(i)">×</button>
			</div>
		</div>
	</div>

</template>
<style lang="scss" scoped>

	.combiner-editor {
		display: flex;
		flex-direction: column;
		gap: 10px;
		flex: 1 1 auto;
		min-height: 0;
	}

	.toolbar {
		display: flex;
		align-items: center;
		gap: 12px;
		flex-wrap: wrap;

		.add-input {
			background: #26262c;
			color: #ddd;
			border: 1px solid #444;
			border-radius: 4px;
			padding: 5px 8px;
		}

		.hint { font-size: 11px; color: #666; }
	}

	.inputs {
		display: flex;
		flex-direction: column;
		gap: 6px;
		overflow-y: auto;
	}

	.empty {
		font-size: 12px;
		color: #777;
		margin: 4px 0;
	}

	.input-row {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 8px;
		background: #1e1e22;
		border: 1px solid #2c2c32;
		border-radius: 6px;

		.reorder {
			display: flex;
			flex-direction: column;
			gap: 2px;

			button {
				width: 20px;
				height: 16px;
				font-size: 9px;
				line-height: 1;
				border: 1px solid #444;
				border-radius: 3px;
				background: #2a2a30;
				color: #bbb;
				cursor: pointer;

				&:disabled { opacity: 0.3; cursor: default; }
				&:hover:not(:disabled) { background: #34343c; }
			}
		}

		.thumb {
			flex: 0 0 auto;
			width: 60px;
			height: 36px;
			background: #0a0a0c;
			border: 1px solid #3a3a42;
			border-radius: 4px;
			overflow: hidden;
			display: flex;
			align-items: center;
			justify-content: center;

			.missing { font-size: 10px; color: #a55; }
		}

		.meta {
			flex: 1 1 auto;
			min-width: 0;
			display: flex;
			flex-direction: column;
			gap: 6px;

			.name {
				font-size: 13px;
				white-space: nowrap;
				overflow: hidden;
				text-overflow: ellipsis;
			}

			.params {
				display: flex;
				align-items: center;
				gap: 10px;
				flex-wrap: wrap;

				label {
					display: flex;
					align-items: center;
					gap: 4px;
					font-size: 11px;
					color: #999;

					input, select {
						background: #26262c;
						color: #ddd;
						border: 1px solid #444;
						border-radius: 4px;
						padding: 3px 5px;
						font-size: 12px;
					}

					input[type="number"] { width: 56px; }
				}

				.base-tag {
					font-size: 10px;
					text-transform: uppercase;
					letter-spacing: 0.06em;
					color: var(--accent);
				}
			}
		}

		.del {
			flex: 0 0 auto;
			width: 22px;
			height: 22px;
			border: none;
			border-radius: 4px;
			background: transparent;
			color: #888;
			cursor: pointer;
			font-size: 16px;
			line-height: 1;

			&:hover { background: rgba(255, 80, 80, 0.25); color: #fff; }
		}
	}

</style>
