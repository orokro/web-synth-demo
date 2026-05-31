<!--
	SynthWindow.vue
	---------------

	Synth settings (the play surface is the Instrument window). Hosts the
	enable-audio gate, the sound-source picker (which wave feeds the synth) with
	a preview, and the envelope placeholder. Editing the chosen source updates
	the sound live via the App's reactive binding.
-->
<script setup>

// vue
import { inject, computed } from "vue";

// components
import WavePreview from "@/components/WavePreview.vue";

// shared app state
const app = inject("app");

// the source currently feeding the synth, if any
const soundSource = computed(() => app.getSource(app.soundSourceId.value));

/**
 * Resumes audio and requests midi access from this user gesture.
 *
 * @returns {void}
 */
function enableAudio() {
	app.enableAudio();
}

/**
 * Sets which source feeds the synth.
 *
 * @param {Event} event - select change event
 * @returns {void}
 */
function onSoundSourceChange(event) {
	app.setSoundSource(event.target.value || null);
}

</script>
<template>

	<div class="synth-window">

		<header class="bar">
			<button v-if="!app.synth.isStarted.value" class="enable" type="button" @click="enableAudio">Enable Audio</button>
			<span v-else class="enabled">Audio on</span>
		</header>

		<div class="fields">
			<div class="field">
				<span class="field-label">Sound wave</span>
				<select :value="app.soundSourceId.value || ''" @change="onSoundSourceChange">
					<option value="">None</option>
					<option v-for="s in app.sources.value" :key="s.id" :value="s.id">{{ s.name.value }}</option>
				</select>
				<div class="preview">
					<WavePreview v-if="soundSource" :samples="soundSource.getCycle()" />
					<span v-else class="none">No source selected</span>
				</div>
			</div>

			<div class="field">
				<span class="field-label">Envelope</span>
				<div class="field-body">Default ADSR — custom envelope in Phase 7</div>
			</div>
		</div>

	</div>

</template>
<style lang="scss" scoped>

	.synth-window {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
		gap: 12px;
		padding: 12px;
		background: #17171a;
		color: #ddd;
		border: 2px solid #696969;
		box-sizing: border-box;
		overflow: auto;
	}

	.bar {
		display: flex;
		align-items: center;
		gap: 16px;
		flex: 0 0 auto;
	}

	.enable {
		padding: 7px 14px;
		border: none;
		border-radius: 5px;
		background: var(--accent);
		color: var(--accent-on);
		font-weight: 600;
		cursor: pointer;
	}

	.enabled { font-size: 12px; color: var(--accent); }

	.fields {
		display: flex;
		flex-wrap: wrap;
		gap: 12px;

		.field {
			flex: 1 1 220px;
			background: #1e1e22;
			border: 1px solid #2c2c32;
			border-radius: 6px;
			padding: 10px;
		}

		.field-label {
			display: block;
			font-size: 11px;
			text-transform: uppercase;
			letter-spacing: 0.08em;
			color: #888;
			margin-bottom: 6px;
		}

		select {
			width: 100%;
			background: #26262c;
			color: #ddd;
			border: 1px solid #444;
			border-radius: 4px;
			padding: 5px 8px;
		}

		.preview {
			margin-top: 8px;
			height: 70px;
			background: #0a0a0c;
			border: 1px solid #2c2c32;
			border-radius: 4px;
			display: flex;
			align-items: center;
			justify-content: center;

			.none { font-size: 12px; color: #666; }
		}

		.field-body { font-size: 13px; color: #bbb; }
	}

</style>
