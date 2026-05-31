/*
	Synth.js
	--------

	Audio output for the demo. Owns a minimal tone.js graph and translates
	note-on / note-off gate events into sound.

	Phase 1 uses a hardcoded polyphonic sine (Tone.PolySynth wrapping
	Tone.Synth). Later phases swap the oscillator for a PeriodicWave generated
	from the user's wave sources, but the gate-driven noteOn / noteOff surface
	stays the same. Audio is suspended until start() runs inside a user gesture
	(browser autoplay policy).
*/

// tone
import * as Tone from "tone";

// vue
import { ref, shallowRef } from "vue";

// main export
export default class Synth {

	/**
	 * Sets up reactive state. The tone.js graph itself is created lazily in
	 * start() so we never touch the audio context before a user gesture.
	 */
	constructor() {

		// whether the audio context has been resumed and the graph built
		this.isStarted = ref(false);

		// midi note numbers currently sounding, for UI key highlighting.
		// stored as a fresh Set on each change so shallowRef notifies.
		this.activeNotes = shallowRef(new Set());

		// the tone.js voice allocator; null until start()
		this.polySynth = null;
	}


	/**
	 * Resumes the audio context and builds the tone.js graph. Safe to call
	 * repeatedly; only the first call does work. Must originate from a user
	 * gesture handler (click, keydown, etc) or the context will stay suspended.
	 *
	 * @returns {Promise<void>} resolves once audio is running
	 */
	async start() {

		if (this.isStarted.value)
			return;

		await Tone.start();

		this.polySynth = new Tone.PolySynth(Tone.Synth).toDestination();
		this.polySynth.set({
			oscillator: { type: "sine" },
			envelope: { attack: 0.01, decay: 0.12, sustain: 0.6, release: 0.25 }
		});

		this.isStarted.value = true;
	}


	/**
	 * Begins a note. Triggers the envelope attack; the note holds at its
	 * sustain level until noteOff() is called (gate-driven — the release time
	 * is not known in advance for live input).
	 *
	 * @param {Number} midiNote - midi note number (0-127)
	 * @param {Number} [velocity=0.8] - normalized velocity (0-1)
	 * @returns {void}
	 */
	noteOn(midiNote, velocity = 0.8) {

		if (!this.isStarted.value || this.polySynth === null)
			return;

		// ignore a repeated note-on for a key that is already held down
		if (this.activeNotes.value.has(midiNote))
			return;

		const freq = Tone.Frequency(midiNote, "midi").toFrequency();
		this.polySynth.triggerAttack(freq, Tone.now(), velocity);

		const next = new Set(this.activeNotes.value);
		next.add(midiNote);
		this.activeNotes.value = next;
	}


	/**
	 * Releases a held note, triggering the envelope release stage from
	 * wherever the envelope currently sits.
	 *
	 * @param {Number} midiNote - midi note number (0-127)
	 * @returns {void}
	 */
	noteOff(midiNote) {

		if (!this.isStarted.value || this.polySynth === null)
			return;

		if (!this.activeNotes.value.has(midiNote))
			return;

		const freq = Tone.Frequency(midiNote, "midi").toFrequency();
		this.polySynth.triggerRelease(freq, Tone.now());

		const next = new Set(this.activeNotes.value);
		next.delete(midiNote);
		this.activeNotes.value = next;
	}


	/**
	 * Releases every currently-held note. Useful when switching midi devices
	 * or when the window loses focus and we might miss key-up events.
	 *
	 * @returns {void}
	 */
	releaseAll() {

		if (this.polySynth !== null)
			this.polySynth.releaseAll();

		this.activeNotes.value = new Set();
	}

}
