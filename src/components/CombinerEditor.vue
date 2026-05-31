<!--
	CombinerEditor.vue
	------------------

	Editor for a CombinedWave: a stack of input sources, each with its own
	frequency (jog wheel), amplitude scale (exp knob) and blend mode (matrix of
	radio buttons). The first input is the base; later inputs blend onto it. Rows
	reorder by dragging the grip handle. An auto-normalize toggle scales the
	output to fit instead of clipping.

	Inputs reference other sources by id, so editing a referenced source updates
	this one live. The add-input list is filtered so picking a source can't
	create a reference cycle.
-->
<script setup>

// vue
import { inject, computed, ref } from "vue";

// components
import WavePreview from "@/components/WavePreview.vue";
import JogWheel from "@/components/widgets/JogWheel.vue";
import Knob from "@/components/widgets/Knob.vue";
import BlendMatrix from "@/components/widgets/BlendMatrix.vue";

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

// drag-reorder state
let dragIndex = -1;
const overIndex = ref(-1);

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

/**
 * Toggles auto-normalize.
 *
 * @param {Event} event - checkbox change
 * @returns {void}
 */
function onNormalizeChange(event) {
	props.source.setNormalize(event.target.checked);
}

/**
 * Begins a row drag-reorder.
 *
 * @param {Number} index - input index
 * @param {DragEvent} event - dragstart
 * @returns {void}
 */
function onDragStart(index, event) {
	dragIndex = index;
	event.dataTransfer.effectAllowed = "move";
	try {
		event.dataTransfer.setData("text/plain", String(index));
	} catch (err) {
		// some browsers are picky; the index is tracked locally anyway
	}
}

/**
 * Marks the row currently hovered during a drag.
 *
 * @param {Number} index - input index
 * @returns {void}
 */
function onDragOver(index) {
	if (overIndex.value !== index)
		overIndex.value = index;
}

/**
 * Drops the dragged row at the given index.
 *
 * @param {Number} index - target index
 * @returns {void}
 */
function onDrop(index) {
	if (dragIndex >= 0 && dragIndex !== index) {
		const arr = inputs.value.slice();
		const [moved] = arr.splice(dragIndex, 1);
		arr.splice(index, 0, moved);
		props.source.setInputs(arr);
	}
	resetDrag();
}

/**
 * Clears drag-reorder state.
 *
 * @returns {void}
 */
function resetDrag() {
	dragIndex = -1;
	overIndex.value = -1;
}

</script>
<template>

	<div class="combiner-editor">
		<div class="toolbar">
			<select class="add-input" @change="onAddSelect">
				<option value="">+ Add input…</option>
				<option v-for="s in available" :key="s.id" :value="s.id">{{ s.name.value }}</option>
			</select>

			<label class="norm-toggle">
				<input type="checkbox" :checked="source.normalize.value" @change="onNormalizeChange" />
				Auto-normalize
			</label>

			<span class="hint">First input is the base; others blend onto it.</span>
		</div>

		<div class="inputs">
			<p v-if="inputs.length === 0" class="empty">No inputs yet — add one above.</p>

			<div
				v-for="(inp, i) in inputs"
				:key="i"
				class="input-row"
				:class="{ over: overIndex === i }"
				@dragover.prevent="onDragOver(i)"
				@drop="onDrop(i)"
				@dragend="resetDrag"
			>
				<span class="grip material-symbols-outlined" draggable="true" title="Drag to reorder" @dragstart="onDragStart(i, $event)">drag_indicator</span>

				<span class="thumb">
					<WavePreview v-if="inputSource(inp)" :samples="inputSource(inp).getCycle()" />
					<span v-else class="missing">missing</span>
				</span>

				<div class="meta">
					<span class="name">{{ inputSource(inp) ? inputSource(inp).name.value : "(deleted source)" }}</span>

					<div class="params">
						<div class="param">
							<span class="plabel">freq</span>
							<input
								type="number"
								min="1"
								max="32"
								step="1"
								:value="inp.frequency"
								@input="updateInput(i, 'frequency', Math.max(1, parseInt($event.target.value) || 1))"
							/>
							<JogWheel
								:model-value="inp.frequency"
								:min="1"
								:max="32"
								:step="1"
								@update:model-value="updateInput(i, 'frequency', $event)"
							/>
						</div>

						<div class="param">
							<span class="plabel">scale</span>
							<Knob
								:model-value="inp.scale"
								:min="0"
								:max="4"
								:curve="2.5"
								@update:model-value="updateInput(i, 'scale', $event)"
							/>
						</div>

						<div class="param blend">
							<BlendMatrix
								v-if="i > 0"
								:model-value="inp.blendMode"
								:options="BLEND_MODES"
								@update:model-value="updateInput(i, 'blendMode', $event)"
							/>
							<span v-else class="base-tag">base</span>
						</div>
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
		gap: 14px;
		flex-wrap: wrap;

		.add-input {
			background: #26262c;
			color: #ddd;
			border: 1px solid #444;
			border-radius: 4px;
			padding: 5px 8px;
		}

		.norm-toggle {
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

	.inputs {
		display: flex;
		flex-direction: column;
		gap: 6px;
		overflow-y: auto;
	}

	.empty { font-size: 12px; color: #777; margin: 4px 0; }

	.input-row {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 8px;
		background: #1e1e22;
		border: 1px solid #2c2c32;
		border-radius: 6px;

		&.over { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent-border) inset; }

		.grip {
			flex: 0 0 auto;
			font-size: 18px;
			color: #777;
			cursor: grab;
			user-select: none;

			&:active { cursor: grabbing; }
			&:hover { color: #bbb; }
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
			gap: 8px;

			.name {
				font-size: 13px;
				white-space: nowrap;
				overflow: hidden;
				text-overflow: ellipsis;
			}

			.params {
				display: flex;
				align-items: flex-start;
				gap: 16px;
				flex-wrap: wrap;
			}

			.param {
				display: flex;
				align-items: center;
				gap: 6px;

				.plabel {
					font-size: 11px;
					color: #999;
					text-transform: uppercase;
					letter-spacing: 0.05em;
				}

				input[type="number"] {
					width: 50px;
					background: #26262c;
					color: #ddd;
					border: 1px solid #444;
					border-radius: 4px;
					padding: 3px 5px;
					font-size: 12px;
				}

				&.blend { align-items: center; }

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
			align-self: flex-start;
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
