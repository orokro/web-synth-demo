/*
	App.js
	------

	Central application state. Instantiated once in App.vue and provided via
	inject("app") to every window component, so any number of windows (and any
	number of views of the same window kind) share one source of truth.

	State lives in vue refs on plain class members rather than making the whole
	instance reactive, so the same object works inside and outside of Vue and
	stays easy to (de)serialize later. The window-manager library is agnostic
	about how we store state — this class is it.
*/

// vue
import { ref, shallowRef } from "vue";

// app logic
import Synth from "@/audio/Synth.js";
import MidiInput from "@/input/MidiInput.js";
import ComputerKeyboard from "@/input/ComputerKeyboard.js";

// main export
export default class App {

	/**
	 * Builds the synth, the input sources and the (currently placeholder) wave
	 * source list, wiring all input methods to the synth.
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

		// Placeholder wave sources until the Phase 2 data model lands. Each is
		// a plain { id, name, type }; real WaveSource classes replace these
		// without changing how windows consume the list or the selection.
		this.sources = shallowRef([]);

		// id of the currently selected source, or null
		this.selectedSourceId = ref(null);

		// counter for friendly placeholder names
		this.sourceCounter = 0;

		// WindowManagerContext, populated once App.vue mounts
		this.wmContext = null;
	}


	/**
	 * Routes a note-on to the synth, resuming the audio context first if it has
	 * not been started yet (so the very first key press still sounds when it
	 * originates from a user gesture).
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
	 * Resumes audio and requests midi access. Intended to be called from an
	 * explicit user gesture (the Enable Audio button) so the midi permission
	 * prompt has a clear trigger.
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
	 * Adds a placeholder wave source and selects it.
	 *
	 * @param {String} [type="generated"] - the source kind
	 * @returns {Object} the created source
	 */
	addSource(type = "generated") {

		this.sourceCounter++;
		const id = (typeof crypto !== "undefined" && crypto.randomUUID) ? crypto.randomUUID() : `src-${this.sourceCounter}-${Date.now()}`;
		const source = { id, name: `Source ${this.sourceCounter}`, type };

		this.sources.value = [...this.sources.value, source];
		this.selectSource(id);
		return source;
	}


	/**
	 * Removes a source by id. If it was selected, selection falls back to the
	 * first remaining source (or null).
	 *
	 * @param {String} id - source id
	 * @returns {void}
	 */
	removeSource(id) {

		this.sources.value = this.sources.value.filter(s => s.id !== id);

		if (this.selectedSourceId.value === id)
			this.selectedSourceId.value = this.sources.value.length ? this.sources.value[0].id : null;
	}


	/**
	 * Sets the current selection.
	 *
	 * @param {String|null} id - source id, or null to clear
	 * @returns {void}
	 */
	selectSource(id) {
		this.selectedSourceId.value = id;
	}


	/**
	 * Looks up a source by id.
	 *
	 * @param {String|null} id - source id
	 * @returns {Object|null} the source, or null if not found
	 */
	getSource(id) {
		return this.sources.value.find(s => s.id === id) || null;
	}


	/**
	 * Stores the window manager context so the app can drive layouts in JS.
	 *
	 * @param {Object} ctx - the WindowManagerContext
	 * @returns {void}
	 */
	setWindowManagerContext(ctx) {
		this.wmContext = ctx;
	}


	/**
	 * Tears down input listeners and silences the synth.
	 *
	 * @returns {void}
	 */
	dispose() {
		this.computerKeyboard.detach();
		this.midiInput.dispose();
		this.synth.releaseAll();
	}

}
