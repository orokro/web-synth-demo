<!--
	EditorWindow.vue
	----------------

	Hosts the editor for a wave source. By default it follows the app's current
	selection; the pin toggle locks it to one source so several editors can edit
	several sources at once. A pinned editor auto-unpins if its source is removed.

	For Phase 2 the generated-wave controls (waveform + pulse width) are live and
	feed the same FFT -> PeriodicWave pipeline as everything else; richer per-type
	editors arrive in later phases.
-->
<script setup>

// vue
import { inject, computed, ref, watch } from "vue";

// components
import WavePreview from "@/components/WavePreview.vue";

// generated waveform names
import { WAVEFORMS } from "@/classes/sources/GeneratedWave.js";

// shared app state + per-window context (for the tab title)
const app = inject("app");
const windowCtx = inject("windowCtx", null);

// pin state is local to this window instance
const pinned = ref(false);
const pinnedId = ref(null);

// the source this editor is bound to
const boundId = computed(() => (pinned.value ? pinnedId.value : app.selectedSourceId.value));
const boundSource = computed(() => app.getSource(boundId.value));

// whether the bound source is the one feeding the synth
const isSoundSource = computed(() => boundId.value !== null && boundId.value === app.soundSourceId.value);

/**
 * Toggles the pin between "follow selection" and "locked to this source".
 *
 * @returns {void}
 */
function togglePin() {

	if (pinned.value) {
		pinned.value = false;
		pinnedId.value = null;
		return;
	}

	if (boundId.value !== null) {
		pinnedId.value = boundId.value;
		pinned.value = true;
	}
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

</script>
<template>

	<div class="editor-window">

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

				<div class="preview"><WavePreview :samples="boundSource.getCycle()" /></div>

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
		box-sizing: border-box;
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
