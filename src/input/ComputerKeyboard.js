/*
	ComputerKeyboard.js
	-------------------

	Maps the computer keyboard to midi notes using the common tracker / DAW
	layout: the Z row is the lower octave and the Q row is one octave above it,
	so the two rows overlap by an octave. Lets users without a midi controller
	still play the synth.

	Attach() adds window key listeners that call the supplied note callbacks;
	detach() removes them. Auto-repeat and keystrokes inside form fields are
	ignored.
*/

// vue
import { ref } from "vue";

// event.code -> semitone offset from the base note. Two playable rows that
// overlap by an octave (Z row low, Q row high).
const KEY_OFFSETS = {
	// lower row (Z..M and beyond): base octave
	KeyZ: 0, KeyS: 1, KeyX: 2, KeyD: 3, KeyC: 4, KeyV: 5, KeyG: 6,
	KeyB: 7, KeyH: 8, KeyN: 9, KeyJ: 10, KeyM: 11, Comma: 12,
	// upper row (Q..P): base octave + 1
	KeyQ: 12, Digit2: 13, KeyW: 14, Digit3: 15, KeyE: 16, KeyR: 17, Digit5: 18,
	KeyT: 19, Digit6: 20, KeyY: 21, Digit7: 22, KeyU: 23, KeyI: 24,
	Digit9: 25, KeyO: 26, Digit0: 27, KeyP: 28
};

// main export
export default class ComputerKeyboard {

	/**
	 * @param {Object} options
	 * @param {function(Number, Number):void} options.onNoteOn - (midiNote, velocity 0-1)
	 * @param {function(Number):void} options.onNoteOff - (midiNote)
	 * @param {Number} [options.baseNote=48] - midi note for the lowest key (default C3)
	 */
	constructor({ onNoteOn, onNoteOff, baseNote = 48 }) {

		this.onNoteOn = onNoteOn;
		this.onNoteOff = onNoteOff;

		// midi note of the lowest mapped key; reactive so the UI can offer octave shifts
		this.baseNote = ref(baseNote);

		// codes currently held, mapped to the midi note they triggered, so a
		// later octave change still releases the correct note
		this.held = new Map();

		// pre-bind handlers so attach/detach reference the same functions
		this.handleKeyDown = this.handleKeyDown.bind(this);
		this.handleKeyUp = this.handleKeyUp.bind(this);
		this.handleBlur = this.handleBlur.bind(this);
	}


	/**
	 * Starts listening for keyboard events on the window.
	 *
	 * @returns {void}
	 */
	attach() {

		window.addEventListener("keydown", this.handleKeyDown);
		window.addEventListener("keyup", this.handleKeyUp);
		window.addEventListener("blur", this.handleBlur);
	}


	/**
	 * Stops listening and releases any held notes.
	 *
	 * @returns {void}
	 */
	detach() {

		window.removeEventListener("keydown", this.handleKeyDown);
		window.removeEventListener("keyup", this.handleKeyUp);
		window.removeEventListener("blur", this.handleBlur);
		this.handleBlur();
	}


	/**
	 * True when the event originated from a text field, so we should not
	 * swallow the keystroke as a note.
	 *
	 * @param {KeyboardEvent} event - the keyboard event
	 * @returns {Boolean}
	 */
	isTypingTarget(event) {

		const el = event.target;
		if (!el || !el.tagName)
			return false;

		const tag = el.tagName.toLowerCase();
		return tag === "input" || tag === "textarea" || tag === "select" || el.isContentEditable === true;
	}


	/**
	 * Translates a key-down into a note-on, ignoring auto-repeat and modified
	 * keystrokes.
	 *
	 * @param {KeyboardEvent} event - the keyboard event
	 * @returns {void}
	 */
	handleKeyDown(event) {

		if (event.repeat || event.metaKey || event.ctrlKey || event.altKey)
			return;

		if (this.isTypingTarget(event))
			return;

		const offset = KEY_OFFSETS[event.code];
		if (offset === undefined || this.held.has(event.code))
			return;

		const note = this.baseNote.value + offset;
		this.held.set(event.code, note);
		this.onNoteOn(note, 0.8);
		event.preventDefault();
	}


	/**
	 * Translates a key-up into a note-off for whatever note that key started.
	 *
	 * @param {KeyboardEvent} event - the keyboard event
	 * @returns {void}
	 */
	handleKeyUp(event) {

		const note = this.held.get(event.code);
		if (note === undefined)
			return;

		this.held.delete(event.code);
		this.onNoteOff(note);
	}


	/**
	 * Releases every held key, e.g. when the window loses focus so we don't
	 * miss the matching key-up events.
	 *
	 * @returns {void}
	 */
	handleBlur() {

		this.held.forEach(note => this.onNoteOff(note));
		this.held.clear();
	}

}
