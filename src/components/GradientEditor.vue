<!--
	GradientEditor.vue
	------------------

	Editor for a GradientWave: stops placed along 0..1 (one cycle), each
	referencing a source wave with its own frequency. The wave crossfades between
	bracketing stops across the cycle. A draggable strip sets stop positions; the
	rows below set each stop's source / frequency and remove it. The morphed
	result preview is the EditorWindow's wave preview above.

	The add-stop list is filtered so a stop can't create a reference cycle.
-->
<script setup>

// vue
import { inject, computed, ref } from "vue";

// components
import WavePreview from "@/components/WavePreview.vue";
import JogWheel from "@/components/widgets/JogWheel.vue";

const props = defineProps({
	// a GradientWave instance
	source: { type: Object, required: true }
});

const app = inject("app");

const stops = computed(() => props.source.getStops());
const available = computed(() => app.sources.value.filter((s) => app.canReference(props.source.id, s.id)));

const stripEl = ref(null);
const selectedIndex = ref(-1);
let dragIndex = -1;

/**
 * Clamp to [0,1].
 *
 * @param {Number} v - value
 * @returns {Number}
 */
function clamp01(v) {
	return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * Default position for a newly added stop.
 *
 * @returns {Number}
 */
function defaultPos() {
	const c = stops.value.length;
	if (c === 0) return 0;
	if (c === 1) return 1;
	return 0.5;
}

/**
 * Patches a field of a stop.
 *
 * @param {Number} i - stop index
 * @param {String} key - field
 * @param {*} value - value
 * @returns {void}
 */
function updateStop(i, key, value) {
	props.source.setStops(stops.value.map((s, idx) => (idx === i ? { ...s, [key]: value } : s)));
}

/**
 * Adds a stop referencing the given source.
 *
 * @param {String} sourceId - source id
 * @returns {void}
 */
function addStop(sourceId) {
	if (!sourceId || !app.canReference(props.source.id, sourceId))
		return;
	props.source.setStops([...stops.value, { sourceId, position: defaultPos(), frequency: 1 }]);
	selectedIndex.value = stops.value.length - 1;
}

/**
 * Add-stop select handler.
 *
 * @param {Event} event - change
 * @returns {void}
 */
function onAddSelect(event) {
	addStop(event.target.value);
	event.target.value = "";
}

/**
 * Removes a stop.
 *
 * @param {Number} i - index
 * @returns {void}
 */
function removeStop(i) {
	props.source.setStops(stops.value.filter((_, idx) => idx !== i));
	if (selectedIndex.value === i)
		selectedIndex.value = -1;
}

/**
 * Resolves a stop's source.
 *
 * @param {Object} stop - stop
 * @returns {Object|null}
 */
function stopSource(stop) {
	return app.getSource(stop.sourceId);
}

/**
 * Begins dragging a stop marker.
 *
 * @param {Number} i - index
 * @param {PointerEvent} e - event
 * @returns {void}
 */
function onMarkerDown(i, e) {
	e.preventDefault();
	selectedIndex.value = i;
	dragIndex = i;
	stripEl.value.setPointerCapture(e.pointerId);
}

/**
 * Drags the active marker along the strip.
 *
 * @param {PointerEvent} e - event
 * @returns {void}
 */
function onStripMove(e) {
	if (dragIndex < 0)
		return;
	const r = stripEl.value.getBoundingClientRect();
	updateStop(dragIndex, "position", clamp01((e.clientX - r.left) / r.width));
}

/**
 * Ends a marker drag.
 *
 * @param {PointerEvent} e - event
 * @returns {void}
 */
function onStripUp(e) {
	dragIndex = -1;
	if (stripEl.value && stripEl.value.hasPointerCapture(e.pointerId))
		stripEl.value.releasePointerCapture(e.pointerId);
}

</script>
<template>

	<div class="gradient-editor">
		<div class="toolbar">
			<select class="add-stop" @change="onAddSelect">
				<option value="">+ Add stop…</option>
				<option v-for="s in available" :key="s.id" :value="s.id">{{ s.name.value }}</option>
			</select>
			<span class="hint">Stops morph across the cycle (0 → 1). Drag markers to position.</span>
		</div>

		<div ref="stripEl" class="strip" @pointermove="onStripMove" @pointerup="onStripUp">
			<div class="tick" style="left: 0%"></div>
			<div class="tick" style="left: 50%"></div>
			<div class="tick" style="left: 100%"></div>
			<div
				v-for="(stop, i) in stops"
				:key="i"
				class="marker"
				:class="{ selected: i === selectedIndex }"
				:style="{ left: (stop.position * 100) + '%' }"
				:title="stopSource(stop) ? stopSource(stop).name.value : '(deleted)'"
				@pointerdown="onMarkerDown(i, $event)"
			>{{ i + 1 }}</div>
		</div>

		<div class="stops">
			<p v-if="stops.length === 0" class="empty">No stops yet — add one above (you need at least two to morph).</p>

			<div
				v-for="(stop, i) in stops"
				:key="i"
				class="stop-row"
				:class="{ selected: i === selectedIndex }"
				@click="selectedIndex = i"
			>
				<span class="num">{{ i + 1 }}</span>

				<span class="thumb">
					<WavePreview v-if="stopSource(stop)" :samples="stopSource(stop).getCycle()" />
					<span v-else class="missing">missing</span>
				</span>

				<div class="meta">
					<select :value="stop.sourceId" @change="updateStop(i, 'sourceId', $event.target.value)">
						<option v-for="s in available" :key="s.id" :value="s.id">{{ s.name.value }}</option>
					</select>
					<div class="params">
						<span class="plabel">pos</span><span class="pval">{{ stop.position.toFixed(2) }}</span>
						<span class="plabel">freq</span>
						<JogWheel :model-value="stop.frequency" :min="1" :max="32" :step="1" @update:model-value="updateStop(i, 'frequency', $event)" />
					</div>
				</div>

				<button class="del" type="button" title="Remove stop" @click.stop="removeStop(i)">×</button>
			</div>
		</div>
	</div>

</template>
<style lang="scss" scoped>

	.gradient-editor {
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

		.add-stop {
			background: #26262c;
			color: #ddd;
			border: 1px solid #444;
			border-radius: 4px;
			padding: 5px 8px;
		}

		.hint { font-size: 11px; color: #666; }
	}

	.strip {
		position: relative;
		height: 40px;
		background: linear-gradient(90deg, #1a1a1e, #2a2a30, #1a1a1e);
		border: 1px solid #2c2c32;
		border-radius: 6px;
		touch-action: none;
		flex: 0 0 auto;

		.tick {
			position: absolute;
			top: 0;
			bottom: 0;
			width: 1px;
			background: rgba(255, 255, 255, 0.08);
		}

		.marker {
			position: absolute;
			top: 50%;
			transform: translate(-50%, -50%);
			width: 22px;
			height: 22px;
			display: flex;
			align-items: center;
			justify-content: center;
			font-size: 11px;
			border-radius: 50%;
			background: radial-gradient(circle at 50% 35%, #4a4a52, #26262b 72%);
			border: 1px solid #1b1b1f;
			box-shadow: 0 1px 2px rgba(0, 0, 0, 0.6), inset 0 1px 1px rgba(255, 255, 255, 0.12);
			color: #ddd;
			cursor: ew-resize;

			&.selected {
				border-color: var(--accent);
				color: var(--accent);
				box-shadow: 0 0 6px var(--accent), inset 0 1px 1px rgba(255, 255, 255, 0.15);
			}
		}
	}

	.stops {
		display: flex;
		flex-direction: column;
		gap: 6px;
		overflow-y: auto;
	}

	.empty { font-size: 12px; color: #777; margin: 4px 0; }

	.stop-row {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 8px;
		background: #1e1e22;
		border: 1px solid #2c2c32;
		border-radius: 6px;
		cursor: pointer;

		&.selected { border-color: var(--accent-border); box-shadow: 0 0 0 1px var(--accent-border) inset; }

		.num {
			flex: 0 0 auto;
			width: 18px;
			text-align: center;
			font-size: 12px;
			color: #888;
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

			select {
				background: #26262c;
				color: #ddd;
				border: 1px solid #444;
				border-radius: 4px;
				padding: 4px 6px;
				max-width: 220px;
			}

			.params {
				display: flex;
				align-items: center;
				gap: 8px;

				.plabel { font-size: 11px; color: #999; text-transform: uppercase; letter-spacing: 0.05em; }
				.pval { font-size: 12px; color: #ccc; font-variant-numeric: tabular-nums; }
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
