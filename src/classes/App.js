/*
	App.js
	------

	Central runtime state. Instantiated once in App.vue and provided via
	inject("app") to every window. Holds the synth and input sources (the
	runtime), plus one Project (the serializable document). The project's
	reactive members are re-exposed here so windows can keep reading app.sources
	etc. State lives in vue refs on plain members so the same object works inside
	and outside Vue and stays easy to serialize.

	Persistence: the whole session (project + window layout) autosaves to
	localStorage debounced on change and on page unload, and is restored on
	startup, so a refresh brings everything back. Sessions can also be
	exported/imported as JSON.
*/

// vue
import { watch, watchEffect } from "vue";

// audio + input
import Synth from "@/audio/Synth.js";
import MidiInput from "@/input/MidiInput.js";
import ComputerKeyboard from "@/input/ComputerKeyboard.js";

// document model
import Project, { SCHEMA_VERSION } from "@/classes/Project.js";

// localStorage key for the autosaved session
const SESSION_KEY = "web-synth-demo:session:v1";

// main export
export default class App {

	/**
	 * Builds the synth, inputs and project, restores any saved session, then
	 * binds the sound source to the synth and starts autosaving.
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

		// the serializable document, and its reactive members re-exposed
		this.project = new Project();
		this.sources = this.project.sources;
		this.selectedSourceId = this.project.selectedSourceId;
		this.soundSourceId = this.project.soundSourceId;

		// window manager context + any layout waiting to be applied once it exists
		this.wmContext = null;
		this.pendingLayout = null;

		// debounce handle for autosave
		this.saveTimer = null;

		// restore a saved session before wiring autosave so we don't echo the load
		this.loadSession();

		// keep the synth's wave in sync with the sound source's cycle
		this.stopSynthBinding = watchEffect(() => {
			const source = this.getSource(this.soundSourceId.value);
			if (source)
				this.synth.setWaveFromSamples(source.getCycle());
		});

		// autosave whenever the serialized project changes (debounced)
		this.stopAutosave = watch(() => JSON.stringify(this.project.toJSON()), () => this.queueSave());

		// capture the final state (including layout) on page unload
		this.onBeforeUnload = () => this.saveSession();
		if (typeof window !== "undefined")
			window.addEventListener("beforeunload", this.onBeforeUnload);
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
	 * Adds a wave source (delegates to the project).
	 *
	 * @returns {Object} the created source
	 */
	addSource() {
		return this.project.addSource();
	}


	/**
	 * Removes a source by id (delegates to the project).
	 *
	 * @param {String} id - source id
	 * @returns {void}
	 */
	removeSource(id) {
		this.project.removeSource(id);
	}


	/**
	 * Sets the editor selection (delegates to the project).
	 *
	 * @param {String|null} id - source id, or null
	 * @returns {void}
	 */
	selectSource(id) {
		this.project.selectSource(id);
	}


	/**
	 * Sets which source feeds the synth (delegates to the project).
	 *
	 * @param {String|null} id - source id, or null
	 * @returns {void}
	 */
	setSoundSource(id) {
		this.project.setSoundSource(id);
	}


	/**
	 * Looks up a source by id (delegates to the project).
	 *
	 * @param {String|null} id - source id
	 * @returns {Object|null}
	 */
	getSource(id) {
		return this.project.getSource(id);
	}


	/**
	 * Clears the project to a fresh, empty state.
	 *
	 * @returns {void}
	 */
	newProject() {
		this.project.clear();
		this.saveSession();
	}


	/**
	 * Builds a full session object (document + current window layout).
	 *
	 * @returns {Object}
	 */
	serializeSession() {
		const layout = this.wmContext && typeof this.wmContext.getLayoutDetails === "function"
			? this.wmContext.getLayoutDetails()
			: (this.pendingLayout || null);
		return {
			schemaVersion: SCHEMA_VERSION,
			project: this.project.toJSON(),
			layout
		};
	}


	/**
	 * Writes the current session to localStorage.
	 *
	 * @returns {void}
	 */
	saveSession() {
		if (typeof localStorage === "undefined")
			return;
		try {
			localStorage.setItem(SESSION_KEY, JSON.stringify(this.serializeSession()));
		} catch (err) {
			// storage full or unavailable — ignore for the demo
		}
	}


	/**
	 * Debounces saveSession so rapid edits coalesce into one write.
	 *
	 * @returns {void}
	 */
	queueSave() {
		if (this.saveTimer)
			clearTimeout(this.saveTimer);
		this.saveTimer = setTimeout(() => this.saveSession(), 400);
	}


	/**
	 * Loads the autosaved session from localStorage, if present.
	 *
	 * @returns {void}
	 */
	loadSession() {
		if (typeof localStorage === "undefined")
			return;
		try {
			const raw = localStorage.getItem(SESSION_KEY);
			if (raw)
				this.loadSessionData(JSON.parse(raw));
		} catch (err) {
			// corrupt or incompatible save — start fresh
		}
	}


	/**
	 * Applies a session object: the document now, and the layout as soon as the
	 * window manager context is available.
	 *
	 * @param {Object} data - output of serializeSession()
	 * @returns {void}
	 */
	loadSessionData(data) {
		if (!data)
			return;
		if (data.project)
			this.project.loadJSON(data.project);
		this.pendingLayout = data.layout || null;
		this.applyPendingLayout();
	}


	/**
	 * Applies a pending layout once the window manager context exists.
	 *
	 * @returns {void}
	 */
	applyPendingLayout() {
		if (this.pendingLayout && this.wmContext && typeof this.wmContext.loadLayout === "function") {
			try {
				this.wmContext.loadLayout(this.pendingLayout);
			} catch (err) {
				// layout incompatible with current windows — keep the default
			}
			this.pendingLayout = null;
		}
	}


	/**
	 * Downloads the current session as a JSON file.
	 *
	 * @returns {void}
	 */
	exportProject() {
		if (typeof document === "undefined")
			return;
		const json = JSON.stringify(this.serializeSession(), null, 2);
		const blob = new Blob([json], { type: "application/json" });
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = "web-synth-project.json";
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		URL.revokeObjectURL(url);
	}


	/**
	 * Loads a session from a user-picked JSON file.
	 *
	 * @param {File} file - the JSON file
	 * @returns {Promise<void>}
	 */
	async importFromFile(file) {
		const text = await file.text();
		this.loadSessionData(JSON.parse(text));
		this.saveSession();
	}


	/**
	 * Stores the window manager context and applies any pending layout.
	 *
	 * @param {Object} ctx - the WindowManagerContext
	 * @returns {void}
	 */
	setWindowManagerContext(ctx) {
		this.wmContext = ctx;
		this.applyPendingLayout();
	}


	/**
	 * Tears down listeners and the synth, saving one last time.
	 *
	 * @returns {void}
	 */
	dispose() {
		this.saveSession();
		if (this.stopSynthBinding)
			this.stopSynthBinding();
		if (this.stopAutosave)
			this.stopAutosave();
		if (typeof window !== "undefined")
			window.removeEventListener("beforeunload", this.onBeforeUnload);
		this.computerKeyboard.detach();
		this.midiInput.dispose();
		this.synth.releaseAll();
	}

}
