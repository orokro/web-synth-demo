/*
	App.js
	------

	Central application state. Instantiated once in App.vue and provided via
	inject("app") to every window, so any number of windows share one source of
	truth. State lives in vue refs on plain members (not a reactive instance) so
	the same object works inside and outside Vue and stays easy to serialize.

	Holds: the synth, the input sources (midi + computer keyboard), the project's
	wave sources, the editor selection, and which source feeds the synth (the
	"sound source"). A reactive binding keeps the synth's wave in sync with the
	sound source's cycle, so editing a source updates the sound live.
*/

// vue
import { ref, shallowRef, watchEffect } from "vue";

// audio + input
import Synth from "@/audio/Synth.js";
import MidiInput from "@/input/MidiInput.js";
import ComputerKeyboard from "@/input/ComputerKeyboard.js";

// wave sources
import GeneratedWave from "@/classes/sources/GeneratedWave.js";

// main export
export default class App {

	/**
	 * Builds the synth, the input sources and the wave-source list, and binds
	 * the sound source to the synth.
	 */
	constructor() {

		// audio output
		this.synth = new Synth();

		// hardware + on-screen input, both routed to noteOn / noteOff
		this.midiInput = new MidiInput({
			onNoteOn: (note, velocity) => this.noteOn(note, velocity),
			onNoteOff: (note) => this.noteOff(note)
		});
		this.computerKeyboard = new ComputerKeyboard({
			onNoteOn: (note, velocity) => this.noteOn(note, velocity),
			onNoteOff: (note) => this.noteOff(note)
		});

		// the project's wave sources (WaveSource instances)
		this.sources = shallowRef([]);

		// id of the source open in the editor, and of the source feeding the synth
		this.selectedSourceId = ref(null);
		this.soundSourceId = ref(null);

		// friendly-name counter
		this.sourceCounter = 0;

		// WindowManagerContext, set on mount
		this.wmContext = null;

		// keep the synth's wave in sync with the sound source's cycle
		this.stopSynthBinding = watchEffect(() => {
			const source = this.getSource(this.soundSourceId.value);
			if (source)
				this.synth.setWaveFromSamples(source.getCycle());
		});
	}


	/**
	 * Routes a note-on to the synth, resuming the audio context first if needed.
	 *
	 * @param {Number} note - midi note number (0-127)
	 * @param {Number} velocity - normalized velocity (0-1)
	 * @returns {void}
	 */
	noteOn(note, velocity) {

		if (!this.synth.isStarted.value) {
			this.synth.start().then(() => this.synth.noteOn(note, velocity));
			return;
		}

		this.synth.noteOn(note, velocity);
	}


	/**
	 * Routes a note-off to the synth.
	 *
	 * @param {Number} note - midi note number (0-127)
	 * @returns {void}
	 */
	noteOff(note) {
		this.synth.noteOff(note);
	}


	/**
	 * Resumes audio and requests midi access from a user gesture.
	 *
	 * @returns {Promise<void>}
	 */
	async enableAudio() {
		await this.synth.start();
		await this.midiInput.requestAccess();
	}


	/**
	 * Starts listening to the computer keyboard.
	 *
	 * @returns {void}
	 */
	attachComputerKeyboard() {
		this.computerKeyboard.attach();
	}


	/**
	 * Adds a generated wave source, selects it, and makes it the sound source if
	 * none is set yet.
	 *
	 * @returns {GeneratedWave} the created source
	 */
	addSource() {

		this.sourceCounter++;
		const source = new GeneratedWave({ name: `Source ${this.sourceCounter}` });

		this.sources.value = [...this.sources.value, source];
		this.selectSource(source.id);

		if (this.soundSourceId.value === null)
			this.soundSourceId.value = source.id;

		return source;
	}


	/**
	 * Removes a source by id, repairing the selection and sound-source bindings.
	 *
	 * @param {String} id - source id
	 * @returns {void}
	 */
	removeSource(id) {

		this.sources.value = this.sources.value.filter((s) => s.id !== id);
		const firstId = this.sources.value.length ? this.sources.value[0].id : null;

		if (this.selectedSourceId.value === id)
			this.selectedSourceId.value = firstId;

		if (this.soundSourceId.value === id)
			this.soundSourceId.value = firstId;
	}


	/**
	 * Sets the editor selection.
	 *
	 * @param {String|null} id - source id, or null
	 * @returns {void}
	 */
	selectSource(id) {
		this.selectedSourceId.value = id;
	}


	/**
	 * Sets which source feeds the synth.
	 *
	 * @param {String|null} id - source id, or null
	 * @returns {void}
	 */
	setSoundSource(id) {
		this.soundSourceId.value = id;
	}


	/**
	 * Looks up a source by id.
	 *
	 * @param {String|null} id - source id
	 * @returns {Object|null}
	 */
	getSource(id) {
		return this.sources.value.find((s) => s.id === id) || null;
	}


	/**
	 * Stores the window manager context.
	 *
	 * @param {Object} ctx - the WindowManagerContext
	 * @returns {void}
	 */
	setWindowManagerContext(ctx) {
		this.wmContext = ctx;
	}


	/**
	 * Tears down input listeners, the synth binding, and silences the synth.
	 *
	 * @returns {void}
	 */
	dispose() {
		if (this.stopSynthBinding)
			this.stopSynthBinding();
		this.computerKeyboard.detach();
		this.midiInput.dispose();
		this.synth.releaseAll();
	}

}
