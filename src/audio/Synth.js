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

		// one-shot preview voice (audition button), independent of played notes
		this.previewNode = null;

		// amplitude envelope used for new notes (set by the App); null = fixed ADSR
		this.envelope = null;
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
	 * Sets the amplitude envelope used for new notes (or null for fixed ADSR).
	 *
	 * @param {Object} envelope - an Envelope instance
	 * @returns {void}
	 */
	setEnvelope(envelope) {
		this.envelope = envelope;
	}


	/**
	 * Schedules the attack/decay -> sustain portion on a fresh gain param,
	 * following the envelope's pre-split shape over attackTime. Falls back to the
	 * fixed ADSR when no envelope is set.
	 *
	 * @param {AudioParam} param - the voice gain's .gain
	 * @param {Number} now - context time to start at
	 * @param {Number} peak - velocity-scaled peak (0-1)
	 * @returns {void}
	 */
	applyAttack(param, now, peak) {

		const env = this.envelope;
		if (!env) {
			param.setValueAtTime(0, now);
			param.linearRampToValueAtTime(peak, now + ENV.attack);
			param.linearRampToValueAtTime(peak * ENV.sustain, now + ENV.attack + ENV.decay);
			return;
		}

		const a = env.stage("attack");
		const hold = env.holdLevel() * peak;

		if (a && a.enabled) {
			const len = Math.max(0.005, a.length);
			const amp = env.stageCurve("attack");
			if (amp) {
				const curve = new Float32Array(amp.length);
				for (let i = 0; i < amp.length; i++)
					curve[i] = Math.max(0, amp[i] * peak);
				param.setValueCurveAtTime(curve, now, len);
				param.setValueAtTime(curve[curve.length - 1], now + len);
			} else {
				// enabled but no source -> linear rise to the hold level
				param.setValueAtTime(0, now);
				param.linearRampToValueAtTime(hold, now + len);
			}
			return;
		}

		// no attack stage -> near-instant rise to the hold level
		param.setValueAtTime(0, now);
		param.linearRampToValueAtTime(hold, now + 0.005);
	}


	/**
	 * Schedules the release from the param's current level to silence, following
	 * the envelope's release shape over releaseTime. Returns the release seconds.
	 * Falls back to a linear ramp with no envelope or if the curve is rejected.
	 *
	 * @param {AudioParam} param - the voice gain's .gain
	 * @param {Number} now - context time to start at
	 * @returns {Number} release duration (s)
	 */
	applyRelease(param, now) {

		const cur = param.value;
		const env = this.envelope;

		if (!env) {
			param.cancelScheduledValues(now);
			param.setValueAtTime(cur, now);
			param.linearRampToValueAtTime(0, now + ENV.release);
			return ENV.release;
		}

		const r = env.stage("release");

		// hold the current level, then schedule the release from there
		if (param.cancelAndHoldAtTime) {
			param.cancelAndHoldAtTime(now);
		} else {
			param.cancelScheduledValues(now);
			param.setValueAtTime(cur, now);
		}

		if (!r || !r.enabled) {
			const t = 0.02;
			param.linearRampToValueAtTime(0, now + t);
			return t;
		}

		const len = Math.max(0.005, r.length);
		const amp = env.stageCurve("release");

		if (!amp) {
			// enabled but no source -> linear from the current level to silence
			param.linearRampToValueAtTime(0, now + len);
			return len;
		}

		try {
			// anchor the curve's in-point to the current level, end at silence
			const r0 = amp[0];
			const scale = r0 > 1e-4 ? cur / r0 : 0;
			const curve = new Float32Array(amp.length);
			for (let i = 0; i < amp.length; i++)
				curve[i] = Math.max(0, amp[i] * scale);
			curve[0] = Math.max(0, cur);
			curve[curve.length - 1] = 0;
			param.setValueCurveAtTime(curve, now, len);
			return len;
		} catch (err) {
			param.cancelScheduledValues(now);
			param.setValueAtTime(cur, now);
			param.linearRampToValueAtTime(0, now + len);
			return len;
		}
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

		// re-pressing a note that's still sounding steals (interrupts) it so the
		// new attack fires immediately — matters for sampler one-shots, which
		// otherwise linger until they finish
		if (this.voices.has(midiNote))
			this.stealVoice(midiNote);

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
		this.applyAttack(gain.gain, now, peak);

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
	 * Immediately retires the voice on a note so a re-press can take its slot.
	 * Uses a very short fade (not an abrupt cut) to avoid a click, then frees
	 * the slot now; the old nodes disconnect themselves on their natural end.
	 *
	 * @param {Number} midiNote - midi note number (0-127)
	 * @returns {void}
	 */
	stealVoice(midiNote) {

		const voice = this.voices.get(midiNote);
		if (!voice)
			return;

		const now = this.ctx.currentTime;
		const g = voice.gain.gain;

		try {
			g.cancelScheduledValues(now);
			g.setValueAtTime(g.value, now);
			g.linearRampToValueAtTime(0, now + 0.006);
			voice.node.stop(now + 0.02);
		} catch (err) {
			// already stopped — fine
		}

		// free the slot right away; finishVoice (via onended) only cleans this
		// old voice's nodes, and its guard leaves the incoming voice untouched
		this.voices.delete(midiNote);
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
		const releaseTime = this.applyRelease(voice.gain.gain, now);

		try {
			voice.node.stop(now + releaseTime + 0.02);
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
	 * Plays a one-shot preview of arbitrary mono samples through the master gain,
	 * independent of the played voices. Re-calling (or stopPreview) interrupts a
	 * preview already in flight.
	 *
	 * @param {Float32Array} data - mono samples to audition
	 * @param {Number} sampleRate - sample rate of the data (Hz)
	 * @param {Function} [onEnded] - called when playback ends (natural or stopped)
	 * @returns {void}
	 */
	previewBuffer(data, sampleRate, onEnded) {

		if (!this.isStarted.value || !this.ctx || !data || data.length < 1)
			return;

		this.stopPreview();

		const buffer = this.ctx.createBuffer(1, data.length, sampleRate || this.ctx.sampleRate);
		buffer.getChannelData(0).set(data);

		const node = this.ctx.createBufferSource();
		node.buffer = buffer;
		node.connect(this.master);

		node.onended = () => {
			try {
				node.disconnect();
			} catch (err) {
				// already disconnected
			}
			if (this.previewNode === node)
				this.previewNode = null;
			if (typeof onEnded === "function")
				onEnded();
		};

		node.start();
		this.previewNode = node;
	}


	/**
	 * Stops the current preview voice, if any.
	 *
	 * @returns {void}
	 */
	stopPreview() {

		if (!this.previewNode)
			return;

		const node = this.previewNode;
		this.previewNode = null;
		try {
			node.stop();
		} catch (err) {
			// already stopped — onended still fires and disconnects it
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
