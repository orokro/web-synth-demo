<!--
	SynthWindow.vue
	---------------

	Synth settings (the play surface is the Instrument window). Hosts the
	enable-audio gate, the sound-source picker (which wave feeds the synth), the
	playback engine (Oscillator vs Sampler + base length / loop), and the
	amplitude-envelope editor. Editing the chosen source updates the sound live in
	Oscillator mode; in Sampler mode edits apply to the next note.
-->
<script setup>

// vue
import { inject, computed } from "vue";

// components
import WavePreview from "@/components/WavePreview.vue";
import EnvelopeEditor from "@/components/EnvelopeEditor.vue";

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

/**
 * Sets the playback engine.
 *
 * @param {String} mode - "oscillator" or "sampler"
 * @returns {void}
 */
function setMode(mode) {
	app.synth.setMode(mode);
}

/**
 * Sets the sampler base length (seconds).
 *
 * @param {Event} event - number input event
 * @returns {void}
 */
function onBaseLength(event) {
	app.synth.setBaseLength(parseFloat(event.target.value));
}

/**
 * Toggles sampler looping.
 *
 * @param {Event} event - checkbox event
 * @returns {void}
 */
function onLoop(event) {
	app.synth.setLoop(event.target.checked);
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
				<span class="field-label">Engine</span>
				<div class="engine-toggle">
					<button type="button" :class="{ on: app.synth.mode.value === 'oscillator' }" @click="setMode('oscillator')">Oscillator</button>
					<button type="button" :class="{ on: app.synth.mode.value === 'sampler' }" @click="setMode('sampler')">Sampler</button>
				</div>

				<template v-if="app.synth.mode.value === 'sampler'">
					<div class="sampler-row">
						<label>Base length (s)
							<input type="number" min="0.02" max="4" step="0.01" :value="app.synth.baseLength.value" @input="onBaseLength" />
						</label>
						<label class="loop">
							<input type="checkbox" :checked="app.synth.loop.value" @change="onLoop" /> Loop
						</label>
					</div>
					<p class="sampler-note">Plays the wave as a one-shot of this length, pitched per key (base = C4). Edits apply to the next note.</p>
				</template>
				<p v-else class="sampler-note">Repeats one cycle at the note pitch; edits update held notes live.</p>
			</div>
		</div>

		<div class="envelope-section">
			<span class="field-label">Envelope</span>
			<EnvelopeEditor />
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

	.bar { display: flex; align-items: center; gap: 16px; flex: 0 0 auto; }

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
		align-items: flex-start;

		.field {
			flex: 1 1 220px;
			background: #1e1e22;
			border: 1px solid #2c2c32;
			border-radius: 6px;
			padding: 10px;
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

	.field-label {
		display: block;
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: #888;
		margin-bottom: 6px;
	}

	.envelope-section {
		flex: 0 0 auto;
		background: #1e1e22;
		border: 1px solid #2c2c32;
		border-radius: 6px;
		padding: 10px;
	}

	.engine-toggle {
		display: flex;
		gap: 4px;

		button {
			flex: 1 1 0;
			padding: 6px 0;
			font-size: 12px;
			border: 1px solid #444;
			border-radius: 4px;
			background: #2a2a30;
			color: #ccc;
			cursor: pointer;
			&:hover { background: #34343c; }
			&.on { background: var(--accent-dim); color: var(--accent); border-color: var(--accent-border); }
		}
	}

	.sampler-row {
		display: flex;
		align-items: center;
		gap: 12px;
		margin-top: 8px;
		flex-wrap: wrap;

		label { font-size: 11px; color: #999; display: flex; align-items: center; gap: 6px; }

		input[type="number"] {
			width: 64px;
			background: #26262c;
			color: #ddd;
			border: 1px solid #444;
			border-radius: 4px;
			padding: 3px 5px;
			font-size: 12px;
		}

		.loop input { accent-color: var(--accent); }
	}

	.sampler-note { margin: 6px 0 0; font-size: 11px; color: #666; }

</style>
