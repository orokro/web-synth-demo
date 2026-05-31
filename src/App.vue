<!--
	App.vue
	-------

	Root layout and wiring for the demo. A left source column sits beside a
	right split of editor (top) and synth (bottom). Owns the Synth and the
	input sources (midi + computer keyboard) and funnels every note event from
	all input methods into the synth.
-->
<script setup>

// vue
import { onMounted, onBeforeUnmount } from "vue";

// app logic
import Synth from "@/audio/Synth.js";
import MidiInput from "@/input/MidiInput.js";
import ComputerKeyboard from "@/input/ComputerKeyboard.js";

// components
import SourceList from "@/components/SourceList.vue";
import SynthView from "@/components/SynthView.vue";

const synth = new Synth();
const midi = new MidiInput({ onNoteOn: handleNoteOn, onNoteOff: handleNoteOff });
const computerKeys = new ComputerKeyboard({ onNoteOn: handleNoteOn, onNoteOff: handleNoteOff });

/**
 * Routes a note-on from any input source to the synth.
 *
 * @param {Number} note - midi note number
 * @param {Number} velocity - normalized velocity (0-1)
 * @returns {void}
 */
function handleNoteOn(note, velocity) {
	synth.noteOn(note, velocity);
}

/**
 * Routes a note-off from any input source to the synth.
 *
 * @param {Number} note - midi note number
 * @returns {void}
 */
function handleNoteOff(note) {
	synth.noteOff(note);
}

/**
 * Enables audio from a user gesture and requests midi access. The piano and
 * computer keyboard also resume audio implicitly, but the button gives a
 * reliable gesture for midi (whose events are not user gestures themselves).
 *
 * @returns {Promise<void>}
 */
async function enableAudio() {
	await synth.start();
	await midi.requestAccess();
}

/**
 * Selects a midi input device by id.
 *
 * @param {String|null} id - device id, or null for none
 * @returns {void}
 */
function selectMidi(id) {
	midi.select(id);
}

onMounted(() => computerKeys.attach());

onBeforeUnmount(() => {
	computerKeys.detach();
	midi.dispose();
	synth.releaseAll();
});

</script>
<template>

	<div class="app">
		<SourceList class="col-sources" />

		<div class="col-main">
			<div class="editor-pane">
				<p class="placeholder">Editor — select or add a source (Phase 2+)</p>
			</div>

			<SynthView
				class="synth-pane"
				:synth="synth"
				:midi="midi"
				@enable-audio="enableAudio"
				@select-midi="selectMidi"
				@note-on="handleNoteOn"
				@note-off="handleNoteOff"
			/>
		</div>
	</div>

</template>
<style>

	/* base reset (global, intentionally not scoped) */
	html, body, #app {
		height: 100%;
		margin: 0;
	}

	body {
		font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
		background: #121214;
	}

</style>
<style lang="scss" scoped>

	.app {
		display: grid;
		grid-template-columns: 240px 1fr;
		height: 100%;
	}

	.col-main {
		display: grid;
		grid-template-rows: 1fr 360px;
		min-width: 0;
	}

	.editor-pane {
		display: flex;
		align-items: center;
		justify-content: center;
		background: #0f0f11;
		border-bottom: 1px solid #000;

		.placeholder {
			color: #555;
			font-size: 14px;
		}
	}

	.synth-pane {
		min-height: 0;
	}

</style>
