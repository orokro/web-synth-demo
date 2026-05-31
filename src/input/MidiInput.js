/*
	MidiInput.js
	------------

	Thin wrapper around the Web MIDI API. Enumerates available midi input
	devices, lets the caller pick one, and forwards note-on / note-off events
	through callbacks.

	Web MIDI is supported on Chromium-based browsers and Firefox 108+, and
	works on http://localhost as well as https origins. Safari has no support,
	in which case isSupported stays false and the app falls back to the
	on-screen / computer keyboard.
*/

// vue
import { ref, shallowRef } from "vue";

// main export
export default class MidiInput {

	/**
	 * @param {Object} handlers - event callbacks
	 * @param {function(Number, Number):void} handlers.onNoteOn - called with (midiNote, velocity 0-1)
	 * @param {function(Number):void} handlers.onNoteOff - called with (midiNote)
	 */
	constructor({ onNoteOn, onNoteOff }) {

		this.onNoteOn = onNoteOn;
		this.onNoteOff = onNoteOff;

		// whether the Web MIDI API exists in this browser
		this.isSupported = ref(typeof navigator !== "undefined" && typeof navigator.requestMIDIAccess === "function");

		// list of { id, name } objects for the device picker
		this.devices = shallowRef([]);

		// id of the currently selected input, or null for none
		this.selectedId = ref(null);

		// human-readable status: unsupported | idle | ready | denied
		this.status = ref(this.isSupported.value ? "idle" : "unsupported");

		// the MIDIAccess object, once permission is granted
		this.access = null;

		// the MIDIInput we've attached our listener to, so we can detach it
		this.boundInput = null;

		// pre-bind the message handler so add/remove reference the same fn
		this.handleMessage = this.handleMessage.bind(this);
	}


	/**
	 * Requests midi access (may prompt the user for permission) and populates
	 * the device list. Should be invoked from a user gesture.
	 *
	 * @returns {Promise<void>}
	 */
	async requestAccess() {

		if (!this.isSupported.value || this.access !== null)
			return;

		try {

			this.access = await navigator.requestMIDIAccess({ sysex: false });
			this.status.value = "ready";

			this.refreshDevices();
			this.access.onstatechange = () => this.refreshDevices();

		} catch (err) {

			this.status.value = "denied";
		}
	}


	/**
	 * Rebuilds the device list from the current MIDIAccess inputs. Clears the
	 * selection if the previously-selected device has disappeared.
	 *
	 * @returns {void}
	 */
	refreshDevices() {

		if (this.access === null)
			return;

		const list = [];
		this.access.inputs.forEach(input => list.push({ id: input.id, name: input.name || "Unknown device" }));
		this.devices.value = list;

		if (this.selectedId.value !== null && !list.some(d => d.id === this.selectedId.value))
			this.select(null);
	}


	/**
	 * Selects a midi input by id and attaches the message listener, detaching
	 * any previously-bound input first.
	 *
	 * @param {String|null} id - device id, or null to detach everything
	 * @returns {void}
	 */
	select(id) {

		if (this.boundInput !== null) {
			this.boundInput.onmidimessage = null;
			this.boundInput = null;
		}

		this.selectedId.value = id;

		if (id === null || id === "" || this.access === null)
			return;

		const input = this.access.inputs.get(id);
		if (input) {
			input.onmidimessage = this.handleMessage;
			this.boundInput = input;
		}
	}


	/**
	 * Parses a raw midi message and dispatches a note event. A note-on with
	 * zero velocity is treated as a note-off, per the running-status
	 * convention many controllers use.
	 *
	 * @param {MIDIMessageEvent} event - raw midi message
	 * @returns {void}
	 */
	handleMessage(event) {

		const data = event.data;
		const command = data[0] & 0xf0;
		const note = data[1];
		const velocity = data.length > 2 ? data[2] : 0;

		if (command === 0x90 && velocity > 0)
			this.onNoteOn(note, velocity / 127);
		else if (command === 0x80 || (command === 0x90 && velocity === 0))
			this.onNoteOff(note);
	}


	/**
	 * Detaches all listeners. Call when tearing down.
	 *
	 * @returns {void}
	 */
	dispose() {

		this.select(null);

		if (this.access !== null)
			this.access.onstatechange = null;
	}

}
