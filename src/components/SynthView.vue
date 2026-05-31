<!--
	SynthView.vue
	-------------

	Bottom pane: the play surface. Hosts the enable-audio gate, the midi device
	picker, placeholders for the sound-source and envelope fields (filled in
	later phases), and the on-screen piano. Input from midi, the computer
	keyboard and the piano all funnel through the same note callbacks owned by
	the parent.
-->
<script setup>

// vue
import { computed } from "vue";

// components
import PianoKeyboard from "@/components/PianoKeyboard.vue";

const props = defineProps({
	// the Synth instance (reactive members read via .value in template)
	synth: { type: Object, required: true },
	// the MidiInput instance
	midi: { type: Object, required: true }
});

const emit = defineEmits(["enable-audio", "note-on", "note-off", "select-midi"]);

// midi status text shown next to the picker
const midiStatusText = computed(() => {
	switch (props.midi.status.value) {
		case "unsupported": return "Web MIDI not supported in this browser";
		case "denied": return "MIDI permission denied";
		case "ready": return props.midi.devices.value.length ? "MIDI ready" : "MIDI ready — no devices found";
		default: return "MIDI not enabled";
	}
});

/**
 * Forwards the midi device picker change to the parent.
 *
 * @param {Event} event - the change event from the select element
 * @returns {void}
 */
function onMidiChange(event) {
	emit("select-midi", event.target.value || null);
}

</script>
<template>

	<section class="synth-view">

		<header class="bar">
			<button
				v-if="!synth.isStarted.value"
				class="enable"
				type="button"
				@click="emit('enable-audio')"
			>Enable Audio</button>
			<span v-else class="enabled">Audio on</span>

			<div class="midi">
				<select
					:disabled="!midi.isSupported.value || midi.status.value !== 'ready'"
					:value="midi.selectedId.value || ''"
					@change="onMidiChange"
				>
					<option value="">No MIDI device</option>
					<option v-for="d in midi.devices.value" :key="d.id" :value="d.id">{{ d.name }}</option>
				</select>
				<span class="status">{{ midiStatusText }}</span>
			</div>
		</header>

		<div class="fields">
			<div class="field">
				<span class="field-label">Sound wave</span>
				<div class="field-body">Sine (built-in) — source picker in Phase 2</div>
			</div>
			<div class="field">
				<span class="field-label">Envelope</span>
				<div class="field-body">Default ADSR — custom envelope in Phase 7</div>
			</div>
		</div>

		<PianoKeyboard
			:active-notes="synth.activeNotes.value"
			:start-note="48"
			:octaves="2"
			@note-on="(note, velocity) => emit('note-on', note, velocity)"
			@note-off="(note) => emit('note-off', note)"
		/>

	</section>

</template>
<style lang="scss" scoped>

	.synth-view {
		display: flex;
		flex-direction: column;
		gap: 12px;
		height: 100%;
		padding: 12px;
		background: #17171a;
		color: #ddd;
		box-sizing: border-box;
	}

	.bar {
		display: flex;
		align-items: center;
		gap: 16px;
		flex-wrap: wrap;
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

	.enabled {
		font-size: 12px;
		color: var(--accent);
	}

	.midi {
		display: flex;
		align-items: center;
		gap: 8px;

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

	.fields {
		display: flex;
		gap: 12px;

		.field {
			flex: 1 1 0;
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

		.field-body {
			font-size: 13px;
			color: #bbb;
		}
	}

</style>
