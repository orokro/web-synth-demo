<!--
	EditorWindow.vue
	----------------

	Hosts the editor for a wave source. By default it follows the app's current
	selection; the pin toggle locks it to one source so several editors can edit
	several sources at once. A pinned editor auto-unpins if its source is removed.

	Pin persistence across reloads: vue-win-mgr serializes only window slugs +
	frame geometry (no per-window ids/props), so this window reports its pin and
	its on-screen center (read from its own DOM element, which is reliable even
	when frameCtx is stale after an undock) to the App. After a reload the App
	re-pins each editor by matching the closest saved center.

	Per-type editor bodies: generated waves get waveform/pulse controls; custom
	waves get the CurveEditor. Richer editors for other types arrive later.
-->
<script setup>

// vue
import { inject, computed, ref, watch, onMounted, onBeforeUnmount } from "vue";

// components
import WavePreview from "@/components/WavePreview.vue";
import CurveEditor from "@/components/CurveEditor.vue";

// generated waveform names
import { WAVEFORMS } from "@/classes/sources/GeneratedWave.js";

// process-wide unique id per editor window instance (for the App pin registry)
let editorUidCounter = 0;

// shared app state + per-window context (for the tab title)
const app = inject("app");
const windowCtx = inject("windowCtx", null);

// unique id for this instance and a ref to our root element (for its center)
const uid = ++editorUidCounter;
const rootEl = ref(null);

// pin state is local to this window instance
const pinned = ref(false);
const pinnedId = ref(null);

// the source this editor is bound to
const boundId = computed(() => (pinned.value ? pinnedId.value : app.selectedSourceId.value));
const boundSource = computed(() => app.getSource(boundId.value));

// whether the bound source is the one feeding the synth
const isSoundSource = computed(() => boundId.value !== null && boundId.value === app.soundSourceId.value);

/**
 * This window's center as a fraction of the viewport, read from its own DOM
 * element so it stays correct even if frameCtx is stale.
 *
 * @returns {{ cx:Number, cy:Number }}
 */
function centerNorm() {
	const el = rootEl.value;
	if (!el || typeof window === "undefined")
		return { cx: 0.5, cy: 0.5 };
	const r = el.getBoundingClientRect();
	return {
		cx: (r.left + r.width / 2) / window.innerWidth,
		cy: (r.top + r.height / 2) / window.innerHeight
	};
}

/**
 * Reports this editor's current center and pin for serialization.
 *
 * @returns {{ cx:Number, cy:Number, pinnedId:(String|null) }}
 */
function report() {
	const c = centerNorm();
	return { cx: c.cx, cy: c.cy, pinnedId: pinned.value ? pinnedId.value : null };
}

/**
 * Claims a saved pin whose center best matches this editor (called once after
 * a restore, when layout has settled). No-op if already pinned.
 *
 * @returns {void}
 */
function claim() {
	if (pinned.value)
		return;
	const c = centerNorm();
	const id = app.claimEditorPin(c.cx, c.cy);
	if (id && app.getSource(id)) {
		pinnedId.value = id;
		pinned.value = true;
	}
}

/**
 * Toggles the pin between "follow selection" and "locked to this source".
 *
 * @returns {void}
 */
function togglePin() {

	if (pinned.value) {
		pinned.value = false;
		pinnedId.value = null;
	} else if (boundId.value !== null) {
		pinnedId.value = boundId.value;
		pinned.value = true;
	}

	app.requestSave();
}

/**
 * Changes the generated waveform.
 *
 * @param {Event} event - select change event
 * @returns {void}
 */
function setWaveform(event) {
	if (boundSource.value)
		boundSource.value.waveform.value = event.target.value;
}

/**
 * Changes the pulse width.
 *
 * @param {Event} event - range input event
 * @returns {void}
 */
function setPulseWidth(event) {
	if (boundSource.value)
		boundSource.value.pulseWidth.value = parseFloat(event.target.value);
}

/**
 * Makes the bound source the synth's sound source.
 *
 * @returns {void}
 */
function useAsSoundSource() {
	if (boundId.value !== null)
		app.setSoundSource(boundId.value);
}

// keep the tab title in sync with the bound source
watch(boundSource, (source) => {
	if (windowCtx && typeof windowCtx.setTitle === "function")
		windowCtx.setTitle(source ? `Editor — ${source.name.value}` : "Editor");
}, { immediate: true });

// unpin if the pinned source disappears
watch(() => app.sources.value, (list) => {
	if (pinned.value && !list.some((s) => s.id === pinnedId.value)) {
		pinned.value = false;
		pinnedId.value = null;
	}
});

onMounted(() => app.registerEditor(uid, { report, claim }));
onBeforeUnmount(() => app.unregisterEditor(uid));

</script>
<template>

	<div ref="rootEl" class="editor-window">

		<header class="bar">
			<span class="title">{{ boundSource ? boundSource.name.value : "No source" }}</span>
			<span v-if="boundSource" class="type">{{ boundSource.type }}</span>

			<button
				class="pin"
				type="button"
				:class="{ active: pinned }"
				:disabled="!pinned && boundId === null"
				:title="pinned ? 'Unpin (follow selection)' : 'Pin to this source'"
				@click="togglePin"
			>
				<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
					<path fill="currentColor" d="M14 4v5l2 3v2h-4v5l-1 1-1-1v-5H6v-2l2-3V4H7V2h8v2h-1z" />
				</svg>
			</button>
		</header>

		<div class="body">
			<template v-if="boundSource">

				<div v-if="boundSource.type !== 'custom'" class="preview">
					<WavePreview :samples="boundSource.getCycle()" />
				</div>

				<div v-if="boundSource.type === 'generated'" class="controls">
					<label class="row">
						<span class="lbl">Waveform</span>
						<select :value="boundSource.waveform.value" @change="setWaveform">
							<option v-for="w in WAVEFORMS" :key="w" :value="w">{{ w }}</option>
						</select>
					</label>

					<label v-if="boundSource.waveform.value === 'pulse'" class="row">
						<span class="lbl">Pulse width</span>
						<input type="range" min="0.05" max="0.95" step="0.01" :value="boundSource.pulseWidth.value" @input="setPulseWidth" />
						<span class="val">{{ boundSource.pulseWidth.value.toFixed(2) }}</span>
					</label>
				</div>

				<CurveEditor v-if="boundSource.type === 'custom'" :source="boundSource" />

				<button class="sound-btn" type="button" :class="{ active: isSoundSource }" @click="useAsSoundSource">
					{{ isSoundSource ? "Feeding the synth" : "Use as sound source" }}
				</button>

			</template>

			<p v-else class="empty">Select or add a source to edit it.</p>
		</div>

	</div>

</template>
<style lang="scss" scoped>

	.editor-window {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
		background: #0f0f11;
		color: #ddd;
		border: 2px solid #696969;
	}

	.bar {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 8px 12px;
		border-bottom: 1px solid #000;
		background: #17171a;
		flex: 0 0 auto;

		.title { font-size: 13px; font-weight: 600; }
		.type { font-size: 10px; text-transform: uppercase; color: #888; }

		.pin {
			margin-left: auto;
			width: 28px;
			height: 24px;
			display: flex;
			align-items: center;
			justify-content: center;
			border: 1px solid #444;
			border-radius: 4px;
			background: #26262c;
			color: #999;
			cursor: pointer;

			&:hover:not(:disabled) { color: #ddd; }
			&.active { background: var(--accent-dim); color: var(--accent); border-color: var(--accent-border); }
			&:disabled { opacity: 0.4; cursor: default; }
		}
	}

	.body {
		flex: 1 1 auto;
		overflow: auto;
		display: flex;
		flex-direction: column;
		gap: 16px;
		padding: 20px;

		.preview {
			width: 100%;
			height: 160px;
			background: #0a0a0c;
			border: 1px solid #2c2c32;
			border-radius: 6px;
		}

		.controls {
			display: flex;
			flex-direction: column;
			gap: 10px;

			.row {
				display: flex;
				align-items: center;
				gap: 10px;

				.lbl {
					width: 90px;
					font-size: 12px;
					color: #aaa;
				}

				select, input[type="range"] {
					background: #26262c;
					color: #ddd;
					border: 1px solid #444;
					border-radius: 4px;
					padding: 4px 6px;
				}

				input[type="range"] { flex: 1 1 auto; accent-color: var(--accent); }
				.val { font-size: 12px; color: #888; width: 36px; text-align: right; }
			}
		}

		.sound-btn {
			align-self: flex-start;
			padding: 7px 12px;
			border: 1px solid #444;
			border-radius: 5px;
			background: #26262c;
			color: #ddd;
			cursor: pointer;

			&:hover { background: #34343c; }
			&.active { background: var(--accent-dim); color: var(--accent); border-color: var(--accent-border); cursor: default; }
		}

		.empty {
			margin: auto;
			color: #555;
			font-size: 14px;
		}
	}

</style>
