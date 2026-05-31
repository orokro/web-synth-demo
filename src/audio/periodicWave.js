/*
	periodicWave.js
	---------------

	Converts a single-cycle, time-domain sample array into a Web Audio
	PeriodicWave via an FFT. This is the heart of the "periodic" audio path:
	any source that can produce one normalized cycle (generated, custom,
	combined, shaped, gradient) becomes a band-limited oscillator waveform that
	the browser anti-aliases for free at every pitch.

	We keep both cosine (real) and sine (imag) coefficients so the waveform the
	user designs is exactly the one that sounds — harmonic phase is preserved,
	not just amplitude.
*/

// fft
import FFT from "fft.js";

// cache one FFT instance per power-of-two size
const fftCache = new Map();

/**
 * Returns a cached FFT instance for the given size.
 *
 * @param {Number} size - transform size, must be a power of two
 * @returns {FFT}
 */
function getFFT(size) {
	if (!fftCache.has(size))
		fftCache.set(size, new FFT(size));
	return fftCache.get(size);
}


/**
 * Computes Web-Audio cosine/sine coefficients from one cycle of samples.
 *
 * The forward DFT gives X[k]; the real (cosine) terms are Re(X[k]) and the
 * sine terms are -Im(X[k]). The DC term is zeroed so waves stay centered.
 * Absolute scale does not matter because callers normalize the wave.
 *
 * @param {Float32Array} samples - one cycle, length a power of two
 * @returns {{ real: Float32Array, imag: Float32Array }}
 */
export function samplesToCoefficients(samples) {

	const n = samples.length;
	const fft = getFFT(n);

	const spectrum = fft.createComplexArray();
	fft.realTransform(spectrum, samples);
	fft.completeSpectrum(spectrum);

	const half = n / 2;
	const real = new Float32Array(half);
	const imag = new Float32Array(half);

	for (let k = 0; k < half; k++) {
		real[k] = spectrum[2 * k];
		imag[k] = -spectrum[2 * k + 1];
	}

	// drop DC so the waveform is centered around zero
	real[0] = 0;
	imag[0] = 0;

	return { real, imag };
}


/**
 * Builds a PeriodicWave from one cycle of samples.
 *
 * @param {BaseAudioContext} ctx - the audio context that will own the wave
 * @param {Float32Array} samples - one cycle, length a power of two
 * @returns {PeriodicWave}
 */
export function createPeriodicWaveFromSamples(ctx, samples) {
	const { real, imag } = samplesToCoefficients(samples);
	return ctx.createPeriodicWave(real, imag, { disableNormalization: false });
}
