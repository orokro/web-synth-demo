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
import MidiInput from "@/input/MidiInput.js";
import ComputerKeyboard from "@/input/ComputerKeyboard.js";

// document model
import Project, { SCHEMA_VERSION } from "@/classes/Project.js";

// localStorage key for the autosaved session
const SESSION_KEY = "web-synth-demo:session:v1";

// max normalized-center distance for an editor to claim a saved pin
const PIN_MATCH_THRESHOLD = 0.12;

// delay after a layout restore before re-pinning editors, to let geometry settle
const RECONCILE_DELAY_MS = 90;

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

		// editor pin registry: uid -> { report(), claim() } + pins awaiting a claim
		this.editorReporters = new Map();
		this.pendingEditorPins = [];
		this.reconcileTimer = null;

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
	 * Registers an editor window's pin handlers.
	 *
	 * @param {Number} uid - the editor instance id
	 * @param {{ report: Function, claim: Function }} handlers - report() returns
	 *        { cx, cy, pinnedId }; claim() adopts a matching saved pin
	 * @returns {void}
	 */
	registerEditor(uid, handlers) {
		this.editorReporters.set(uid, handlers);
	}


	/**
	 * Unregisters an editor window.
	 *
	 * @param {Number} uid - the editor instance id
	 * @returns {void}
	 */
	unregisterEditor(uid) {
		this.editorReporters.delete(uid);
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
	 * Claims the saved pin whose normalized center is closest to (cx, cy), if
	 * within the match threshold. The claimed entry is consumed so stacked
	 * editors take successive pins.
	 *
	 * @param {Number} cx - normalized center x (0-1)
	 * @param {Number} cy - normalized center y (0-1)
	 * @returns {String|null} the pinned source id, or null if no match
	 */
	claimEditorPin(cx, cy) {

		let bestIndex = -1;
		let bestDist = Infinity;

		for (let i = 0; i < this.pendingEditorPins.length; i++) {
			const entry = this.pendingEditorPins[i];
			const dist = Math.hypot(entry.cx - cx, entry.cy - cy);
			if (dist < bestDist) {
				bestDist = dist;
				bestIndex = i;
			}
		}

		if (bestIndex === -1 || bestDist > PIN_MATCH_THRESHOLD)
			return null;

		const [entry] = this.pendingEditorPins.splice(bestIndex, 1);
		return entry.pinnedId || null;
	}


	/**
	 * Schedules a one-shot pass that lets each editor claim its saved pin, once
	 * the restored layout has had a moment to settle.
	 *
	 * @returns {void}
	 */
	scheduleReconcile() {
		if (this.reconcileTimer)
			clearTimeout(this.reconcileTimer);
		this.reconcileTimer = setTimeout(() => this.reconcileEditorPins(), RECONCILE_DELAY_MS);
	}


	/**
	 * Schedules a reconcile only if there are pins to restore and the window
	 * manager is ready.
	 *
	 * @returns {void}
	 */
	maybeScheduleReconcile() {
		if (this.wmContext && this.pendingEditorPins.length)
			this.scheduleReconcile();
	}


	/**
	 * Lets every registered editor claim a matching saved pin, then clears the
	 * pending set so late-created editors don't grab leftovers.
	 *
	 * @returns {void}
	 */
	reconcileEditorPins() {
		this.reconcileTimer = null;
		this.editorReporters.forEach((handlers) => {
			if (handlers && typeof handlers.claim === "function")
				handlers.claim();
		});
		this.pendingEditorPins = [];
		this.queueSave();
	}


	/**
	 * Builds a full session object (document + window layout + editor pins).
	 *
	 * @returns {Object}
	 */
	serializeSession() {

		const layout = this.wmContext && typeof this.wmContext.getLayoutDetails === "function"
			? this.wmContext.getLayoutDetails()
			: (this.pendingLayout || null);

		const editorPins = [];
		this.editorReporters.forEach((handlers) => {
			if (handlers && typeof handlers.report === "function") {
				const entry = handlers.report();
				if (entry && entry.pinnedId)
					editorPins.push(entry);
			}
		});

		return {
			schemaVersion: SCHEMA_VERSION,
			project: this.project.toJSON(),
			layout,
			editorPins
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
		this.pendingLayout = data.layout || null;
		this.pendingEditorPins = Array.isArray(data.editorPins) ? data.editorPins.slice() : [];
		this.applyPendingLayout();
		this.maybeScheduleReconcile();
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
		this.maybeScheduleReconcile();
	}


	/**
	 * Tears down listeners and the synth, saving one last time.
	 *
	 * @returns {void}
	 */
	dispose() {
		this.saveSession();
		if (this.reconcileTimer)
			clearTimeout(this.reconcileTimer);
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
