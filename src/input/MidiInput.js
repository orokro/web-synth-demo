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

// localStorage key for the last-used device id (auto-selected on return visits)
const LAST_DEVICE_KEY = "web-synth-demo:midi-device";

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

		if (id)
			this.saveLastId(id);

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
	 * Persists the last chosen device id for auto-selection on the next visit.
	 *
	 * @param {String} id - device id
	 * @returns {void}
	 */
	saveLastId(id) {
		try {
			localStorage.setItem(LAST_DEVICE_KEY, id);
		} catch (err) {
			// storage unavailable — fine
		}
	}


	/**
	 * Reads the last chosen device id, if any.
	 *
	 * @returns {String|null}
	 */
	loadLastId() {
		try {
			return localStorage.getItem(LAST_DEVICE_KEY);
		} catch (err) {
			return null;
		}
	}


	/**
	 * Selects the previously-used device if present, else the only device when
	 * there's exactly one. No-op if a device is already selected.
	 *
	 * @returns {void}
	 */
	autoSelect() {
		if (this.access === null || this.selectedId.value)
			return;
		const list = this.devices.value;
		const last = this.loadLastId();
		if (last && list.some((d) => d.id === last)) {
			this.select(last);
			return;
		}
		if (list.length === 1)
			this.select(list[0].id);
	}


	/**
	 * If MIDI was already granted on a previous visit, connects silently (no
	 * prompt) and auto-selects the last device — so a returning user's keyboard is
	 * ready with no interaction. Safe to call on load; no-op without permission.
	 *
	 * @returns {Promise<void>}
	 */
	async autoConnect() {
		if (!this.isSupported.value || this.access !== null)
			return;
		try {
			if (!navigator.permissions || !navigator.permissions.query)
				return;
			const status = await navigator.permissions.query({ name: "midi" });
			if (status.state !== "granted")
				return;
		} catch (err) {
			return;
		}
		await this.requestAccess();
		this.autoSelect();
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
