<!--
	InstrumentWindow.vue
	--------------------

	Window for playing the synth: the midi device picker, input settings and the
	on-screen piano. Every input method (midi, computer keyboard, clicking the
	piano) routes through the shared App, so the piano highlights notes from all
	of them. Fills its parent frame; the piano sits at the bottom and the keys
	flex to the available width.
-->
<script setup>

// vue
import { inject, computed } from "vue";

// components
import PianoKeyboard from "@/components/PianoKeyboard.vue";

// shared app state
const app = inject("app");

// status text for the midi picker
const midiStatusText = computed(() => {
	switch (app.midiInput.status.value) {
		case "unsupported": return "Web MIDI not supported in this browser";
		case "denied": return "MIDI permission denied";
		case "ready": return app.midiInput.devices.value.length ? "MIDI ready" : "MIDI ready — no devices found";
		default: return "Enable audio to connect MIDI";
	}
});

/**
 * Forwards the device picker change to the midi input.
 *
 * @param {Event} event - change event from the select element
 * @returns {void}
 */
function onMidiChange(event) {
	app.midiInput.select(event.target.value || null);
}

</script>
<template>

	<div class="instrument-window">

		<header class="bar">
			<div class="midi">
				<label>MIDI</label>
				<select
					:disabled="!app.midiInput.isSupported.value || app.midiInput.status.value !== 'ready'"
					:value="app.midiInput.selectedId.value || ''"
					@change="onMidiChange"
				>
					<option value="">No MIDI device</option>
					<option v-for="d in app.midiInput.devices.value" :key="d.id" :value="d.id">{{ d.name }}</option>
				</select>
				<span class="status">{{ midiStatusText }}</span>
			</div>
		</header>

		<div class="piano-wrap">
			<PianoKeyboard
				:active-notes="app.synth.activeNotes.value"
				:start-note="48"
				:octaves="2"
				@note-on="(note, velocity) => app.noteOn(note, velocity)"
				@note-off="(note) => app.noteOff(note)"
			/>
		</div>

		<p class="hint">Computer keys: Z row = low octave, Q row = high octave.</p>

	</div>

</template>
<style lang="scss" scoped>

	.instrument-window {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
		padding: 12px;
		background: #17171a;
		color: #ddd;
		border: 2px solid #696969;
		box-sizing: border-box;
	}

	.bar {
		flex: 0 0 auto;

		.midi {
			display: flex;
			align-items: center;
			gap: 8px;
			flex-wrap: wrap;

			label {
				font-size: 11px;
				text-transform: uppercase;
				letter-spacing: 0.08em;
				color: #888;
			}

			select {
				background: #26262c;
				color: #ddd;
				border: 1px solid #444;
				border-radius: 4px;
				padding: 5px 8px;
			}

			.status {
				font-size: 12px;
				color: #888;
			}
		}
	}

	.piano-wrap {
		flex: 1 1 auto;
		display: flex;
		align-items: flex-end;
		min-height: 120px;
		padding: 12px 0;
	}

	.hint {
		flex: 0 0 auto;
		margin: 0;
		font-size: 11px;
		color: #666;
	}

</style>
