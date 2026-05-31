/*
	Synth.js
	--------

	Audio output. Plays whatever single-cycle wave it is given as a band-limited
	PeriodicWave through a small polyphonic voice pool, each voice an
	OscillatorNode -> GainNode (ADSR) -> master gain -> destination.

	We use tone.js to own/unlock the audio context (so the target app's Tone
	graph slots in later) but build the voices on its raw context with native
	createPeriodicWave, so the exact designed waveform — harmonic phase and all
	— is what sounds. The wave can be hot-swapped on already-sounding voices, so
	tweaking a source updates the held note live.

	Gate-driven: noteOn triggers attack/decay to a held sustain; noteOff
	triggers release. The release time is never needed in advance.
*/

// tone
import * as Tone from "tone";

// vue
import { ref, shallowRef } from "vue";

// time-domain cycle -> cosine/sine coefficients
import { samplesToCoefficients } from "./periodicWave.js";

// fixed ADSR for Phase 2; the custom-envelope work in Phase 7 replaces this
const ENV = { attack: 0.01, decay: 0.12, sustain: 0.6, release: 0.25 };

// main export
export default class Synth {

	/**
	 * Sets up reactive state only; the audio graph is built lazily in start().
	 */
	constructor() {

		// whether the context is running and the graph is built
		this.isStarted = ref(false);

		// midi note numbers currently sounding, for UI highlighting
		this.activeNotes = shallowRef(new Set());

		// raw audio context + master gain, created in start()
		this.ctx = null;
		this.master = null;

		// the current band-limited wave, and the raw samples it came from
		this.periodicWave = null;
		this.samples = null;

		// midiNote -> { osc, gain }
		this.voices = new Map();
	}


	/**
	 * Resumes the audio context and builds the master gain. Must be called from
	 * a user gesture. Safe to call repeatedly.
	 *
	 * @returns {Promise<void>}
	 */
	async start() {

		if (this.isStarted.value)
			return;

		await Tone.start();

		this.ctx = Tone.getContext().rawContext;
		this.master = this.ctx.createGain();
		this.master.gain.value = 0.8;
		this.master.connect(this.ctx.destination);

		// build the wave now if a source already handed us samples
		if (this.samples)
			this.rebuildWave();

		this.isStarted.value = true;
	}


	/**
	 * Sets the wave to play from one cycle of samples. Rebuilds the band-limited
	 * PeriodicWave and hot-swaps it onto any currently-held voices.
	 *
	 * @param {Float32Array} samples - one normalized cycle (power-of-two length)
	 * @returns {void}
	 */
	setWaveFromSamples(samples) {

		this.samples = samples;

		if (this.isStarted.value)
			this.rebuildWave();
	}


	/**
	 * Rebuilds this.periodicWave from this.samples and applies it to held voices.
	 *
	 * @returns {void}
	 */
	rebuildWave() {

		if (!this.ctx || !this.samples)
			return;

		const { real, imag } = samplesToCoefficients(this.samples);
		this.periodicWave = this.ctx.createPeriodicWave(real, imag, { disableNormalization: false });

		this.voices.forEach((voice) => voice.osc.setPeriodicWave(this.periodicWave));
	}


	/**
	 * Begins a note (attack -> decay -> hold at sustain).
	 *
	 * @param {Number} midiNote - midi note number (0-127)
	 * @param {Number} [velocity=0.8] - normalized velocity (0-1)
	 * @returns {void}
	 */
	noteOn(midiNote, velocity = 0.8) {

		if (!this.isStarted.value || !this.ctx)
			return;

		if (this.voices.has(midiNote))
			return;

		const now = this.ctx.currentTime;
		const osc = this.ctx.createOscillator();
		const gain = this.ctx.createGain();

		if (this.periodicWave)
			osc.setPeriodicWave(this.periodicWave);
		else
			osc.type = "sine";

		osc.frequency.value = 440 * Math.pow(2, (midiNote - 69) / 12);

		const peak = Math.max(0.0001, velocity);
		gain.gain.setValueAtTime(0, now);
		gain.gain.linearRampToValueAtTime(peak, now + ENV.attack);
		gain.gain.linearRampToValueAtTime(peak * ENV.sustain, now + ENV.attack + ENV.decay);

		osc.connect(gain);
		gain.connect(this.master);
		osc.start(now);

		this.voices.set(midiNote, { osc, gain });

		const next = new Set(this.activeNotes.value);
		next.add(midiNote);
		this.activeNotes.value = next;
	}


	/**
	 * Releases a held note (release ramp from its current level, then stop).
	 *
	 * @param {Number} midiNote - midi note number (0-127)
	 * @returns {void}
	 */
	noteOff(midiNote) {

		const voice = this.voices.get(midiNote);
		if (!voice)
			return;

		const now = this.ctx.currentTime;
		const g = voice.gain.gain;

		g.cancelScheduledValues(now);
		g.setValueAtTime(g.value, now);
		g.linearRampToValueAtTime(0, now + ENV.release);

		voice.osc.stop(now + ENV.release + 0.02);
		voice.osc.onended = () => {
			voice.osc.disconnect();
			voice.gain.disconnect();
		};

		this.voices.delete(midiNote);

		const next = new Set(this.activeNotes.value);
		next.delete(midiNote);
		this.activeNotes.value = next;
	}


	/**
	 * Releases every held note immediately.
	 *
	 * @returns {void}
	 */
	releaseAll() {

		Array.from(this.voices.keys()).forEach((note) => this.noteOff(note));
		this.activeNotes.value = new Set();
	}

}
