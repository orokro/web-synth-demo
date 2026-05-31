/*
	Synth.js
	--------

	Audio output with two playback engines for the same wave data:

	- Oscillator mode: the source's single cycle drives an OscillatorNode via a
	  band-limited PeriodicWave, repeated at the note pitch (live-tweakable, the
	  wave hot-swaps on held voices).
	- Sampler mode: the source is rendered at high resolution into an AudioBuffer
	  of `baseLength` seconds and played one-shot (optionally looped), pitched by
	  playback rate relative to a base note — i.e. "play this wave like a sample"
	  (music-box style). Edits apply to the next note (a playing buffer can't swap).

	Each voice is NODE -> GainNode (ADSR) -> master gain -> destination. Built on
	tone.js's context so the target app's Tone graph slots in later.
*/

// tone
import * as Tone from "tone";

// vue
import { ref, shallowRef } from "vue";

// time-domain cycle -> cosine/sine coefficients (oscillator path)
import { samplesToCoefficients } from "./periodicWave.js";

// fixed ADSR for now; the custom-envelope work in Phase 7 replaces this
const ENV = { attack: 0.01, decay: 0.12, sustain: 0.6, release: 0.25 };

// midi note at which a sampler buffer plays at its natural rate
const SAMPLER_BASE_NOTE = 60;

// cap the rendered sampler buffer length (seconds) to bound memory/CPU
const MAX_SAMPLE_SECONDS = 4;

/**
 * Midi note -> frequency (Hz).
 *
 * @param {Number} midiNote - midi note number
 * @returns {Number}
 */
function midiToFreq(midiNote) {
	return 440 * Math.pow(2, (midiNote - 69) / 12);
}

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

		// playback engine + sampler settings (reactive so the UI + binding react)
		this.mode = ref("oscillator");
		this.baseLength = ref(1.0);
		this.loop = ref(false);

		// raw audio context + master gain, created in start()
		this.ctx = null;
		this.master = null;

		// the sound source + its cached cycle (oscillator) and rendered buffer (sampler)
		this.soundSource = null;
		this.samples = null;
		this.periodicWave = null;
		this.sampleBuffer = null;

		// midiNote -> { node, gain, isOsc }
		this.voices = new Map();
	}


	/**
	 * Resumes the audio context and builds the master gain. Must be called from a
	 * user gesture. Safe to call repeatedly.
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

		this.isStarted.value = true;
		this.rebuildCurrent();
	}


	/**
	 * Sets the sound source and its current cycle, then rebuilds whatever the
	 * active mode needs. Called reactively by the App when the source or its
	 * parameters change.
	 *
	 * @param {Object} source - the WaveSource feeding the synth
	 * @param {Float32Array} cycleSamples - the source's cached single cycle
	 * @returns {void}
	 */
	setSoundSource(source, cycleSamples) {
		this.soundSource = source;
		this.samples = cycleSamples;
		if (this.isStarted.value)
			this.rebuildCurrent();
	}


	/**
	 * Sets the playback engine.
	 *
	 * @param {String} mode - "oscillator" or "sampler"
	 * @returns {void}
	 */
	setMode(mode) {
		this.mode.value = mode === "sampler" ? "sampler" : "oscillator";
		if (this.isStarted.value)
			this.rebuildCurrent();
	}


	/**
	 * Sets the sampler base length in seconds (clamped).
	 *
	 * @param {Number} seconds - base length
	 * @returns {void}
	 */
	setBaseLength(seconds) {
		this.baseLength.value = Math.min(MAX_SAMPLE_SECONDS, Math.max(0.02, seconds || 0.02));
		if (this.isStarted.value && this.mode.value === "sampler")
			this.rebuildBuffer();
	}


	/**
	 * Sets sampler looping.
	 *
	 * @param {Boolean} on - whether to loop
	 * @returns {void}
	 */
	setLoop(on) {
		this.loop.value = !!on;
	}


	/**
	 * Rebuilds whatever the current mode plays from.
	 *
	 * @returns {void}
	 */
	rebuildCurrent() {
		if (this.mode.value === "sampler")
			this.rebuildBuffer();
		else
			this.rebuildWave();
	}


	/**
	 * Rebuilds the oscillator PeriodicWave from the cached cycle and hot-swaps it
	 * onto held oscillator voices.
	 *
	 * @returns {void}
	 */
	rebuildWave() {

		if (!this.ctx || !this.samples)
			return;

		const { real, imag } = samplesToCoefficients(this.samples);
		this.periodicWave = this.ctx.createPeriodicWave(real, imag, { disableNormalization: false });

		this.voices.forEach((voice) => {
			if (voice.isOsc)
				voice.node.setPeriodicWave(this.periodicWave);
		});
	}


	/**
	 * Renders the sound source at high resolution into the sampler AudioBuffer.
	 *
	 * @returns {void}
	 */
	rebuildBuffer() {

		if (!this.ctx || !this.soundSource)
			return;

		const rate = this.ctx.sampleRate;
		const n = Math.max(1, Math.min(MAX_SAMPLE_SECONDS * rate, Math.round(this.baseLength.value * rate)));
		const data = this.soundSource.render(n);

		const buffer = this.ctx.createBuffer(1, n, rate);
		buffer.getChannelData(0).set(data);
		this.sampleBuffer = buffer;
	}


	/**
	 * Begins a note in the active engine (attack -> decay -> hold at sustain).
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
		const gain = this.ctx.createGain();
		const useSampler = this.mode.value === "sampler" && this.sampleBuffer;

		let node;
		if (useSampler) {
			node = this.ctx.createBufferSource();
			node.buffer = this.sampleBuffer;
			node.loop = this.loop.value;
			node.playbackRate.value = Math.pow(2, (midiNote - SAMPLER_BASE_NOTE) / 12);
		} else {
			node = this.ctx.createOscillator();
			if (this.periodicWave)
				node.setPeriodicWave(this.periodicWave);
			else
				node.type = "sine";
			node.frequency.value = midiToFreq(midiNote);
		}

		const peak = Math.max(0.0001, velocity);
		gain.gain.setValueAtTime(0, now);
		gain.gain.linearRampToValueAtTime(peak, now + ENV.attack);
		gain.gain.linearRampToValueAtTime(peak * ENV.sustain, now + ENV.attack + ENV.decay);

		node.connect(gain);
		gain.connect(this.master);
		node.start(now);

		const voice = { node, gain, isOsc: !useSampler };
		this.voices.set(midiNote, voice);

		// natural end (a non-looping sampler one-shot) cleans itself up
		node.onended = () => this.finishVoice(midiNote, voice);

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

		try {
			voice.node.stop(now + ENV.release + 0.02);
		} catch (err) {
			// already stopped (e.g. a one-shot that finished) — fine
		}
	}


	/**
	 * Disconnects and forgets a voice (from natural end or after release).
	 *
	 * @param {Number} midiNote - midi note number
	 * @param {Object} voice - the voice record
	 * @returns {void}
	 */
	finishVoice(midiNote, voice) {

		try {
			voice.node.disconnect();
			voice.gain.disconnect();
		} catch (err) {
			// already disconnected
		}

		if (this.voices.get(midiNote) === voice) {
			this.voices.delete(midiNote);
			const next = new Set(this.activeNotes.value);
			next.delete(midiNote);
			this.activeNotes.value = next;
		}
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
