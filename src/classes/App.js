/*
	App.js
	------

	Central runtime state. Instantiated once in App.vue and provided via
	inject("app") to every window. Holds the synth and input sources (the
	runtime), plus one Project (the serializable document). The project's
	reactive members are re-exposed here so windows can keep reading app.sources
	etc. State lives in vue refs on plain members so the same object works inside
	and outside Vue and stays easy to serialize.

	Persistence: the whole session (project + window layout + editor pins)
	autosaves to localStorage debounced on change and on page unload, and is
	restored on startup, so a refresh brings everything back. Sessions can also
	be exported/imported as JSON.

	Editor pins: vue-win-mgr serializes only window slugs + frame geometry (no
	per-window ids/props), so editor windows report their pin and on-screen
	center to this registry. After a restore, once the layout has settled, each
	editor claims the saved pin whose normalized center best matches it. Centers
	are normalized [0..1], so matching is resolution-independent.
*/

// vue
import { watch, watchEffect } from "vue";

// audio + input
import Synth from "@/audio/Synth.js";
import Envelope from "@/audio/Envelope.js";
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

		// synth-wide amplitude envelope; loadSession() may repopulate it in place.
		// stages reference project sources by id, resolved the same way sources do.
		this.envelope = new Envelope();
		this.envelope.resolve = (id) => this.getSource(id);
		this.synth.setEnvelope(this.envelope);

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
			// track engine + base length so mode/length changes re-bind
			const mode = this.synth.mode.value;
			const baseLength = this.synth.baseLength.value;
			void mode;
			void baseLength;
			if (!source)
				return;
			// read the cycle so any upstream edit re-runs this effect
			const cycle = source.getCycle();
			this.synth.setSoundSource(source, cycle);
		});

		// autosave whenever the serialized project changes (debounced)
		this.stopAutosave = watch(() => JSON.stringify({ project: this.project.toJSON(), synth: this.serializeSynth() }), () => this.queueSave());

		// capture the final state (including layout + pins) on page unload
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
		this.midiInput.autoSelect();
	}


	/**
	 * On load, connect MIDI silently if already permitted (pre-selecting the last
	 * device) and attempt a silent audio resume. Audio still needs a user gesture
	 * on most loads (browser policy) — the gate covers that.
	 *
	 * @returns {Promise<void>}
	 */
	async tryAutoEnable() {
		this.midiInput.autoConnect();
		const running = await this.synth.tryAutoStart();
		if (running)
			this.midiInput.autoSelect();
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
	addSource(type) {
		return this.project.addSource(type);
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
	 * Whether `fromId` may reference `toId` without creating a cycle.
	 *
	 * @param {String} fromId - the referencing source
	 * @param {String} toId - the prospective input
	 * @returns {Boolean}
	 */
	canReference(fromId, toId) {
		return !this.project.wouldCreateCycle(fromId, toId);
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
	 * Requests a (debounced) save, e.g. after a pin toggle that the project
	 * watch would not otherwise notice.
	 *
	 * @returns {void}
	 */
	requestSave() {
		this.queueSave();
	}


	/**
	 * Serializes the synth playback settings (engine + sampler params).
	 *
	 * @returns {Object}
	 */
	serializeSynth() {
		return {
			mode: this.synth.mode.value,
			baseLength: this.synth.baseLength.value,
			loop: this.synth.loop.value,
			envelope: this.envelope.toJSON()
		};
	}


	/**
	 * Builds a full session object (document + window layout + editor pins + synth).
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
			layout,
			synth: this.serializeSynth()
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
	 * Applies a session object: the document now, the layout as soon as the
	 * window manager context is available, and the pins once it settles.
	 *
	 * @param {Object} data - output of serializeSession()
	 * @returns {void}
	 */
	loadSessionData(data) {
		if (!data)
			return;
		if (data.project)
			this.project.loadJSON(data.project);
		if (data.synth) {
			if (data.synth.mode === "sampler" || data.synth.mode === "oscillator")
				this.synth.mode.value = data.synth.mode;
			if (typeof data.synth.baseLength === "number")
				this.synth.baseLength.value = data.synth.baseLength;
			if (typeof data.synth.loop === "boolean")
				this.synth.loop.value = data.synth.loop;
			if (data.synth.envelope)
				this.envelope.loadJSON(data.synth.envelope);
		}
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
	 * Stores the window manager context, applies any pending layout, and
	 * schedules pin reconciliation.
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
