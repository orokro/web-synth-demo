# Web Synth — a wave-design synthesizer in the browser

A browser-based synthesizer built around one simple idea: **a wave is a wave.**
Design a waveform any number of ways — draw it, generate it, combine others,
carve it with shapes, morph between waves, or import an audio sample — then play
it through a MIDI keyboard, the on-screen piano, or your computer keys.

It's built with [Vue 3](https://vuejs.org/), [Vite](https://vite.dev/),
[Tone.js](https://tonejs.github.io/), and a Blender-style dockable window
manager ([vue-win-mgr](https://github.com/orokro/Vue-Window-Manager)). Everything
runs client-side, autosaves to your browser, and exports/imports as a single
JSON file.

> ⚠️ This is a research/demo prototype — a sandbox for validating ideas that may
> later be folded into a larger Tone.js application. Have fun with it.

**▶️ Live demo:** https://orokro.github.io/web-synth-demo/

---

## ✨ Features

### One wave, two engines
Every source produces a single function over the cycle. The synth can play it two ways:
- **Oscillator** — the cycle drives a band-limited `PeriodicWave` (FFT → harmonic
  coefficients), repeated at the note pitch. Edits hot-swap onto held notes.
- **Sampler** — the wave is rendered into an `AudioBuffer` of a chosen length and
  played as a one-shot, pitched per key (music-box style), optionally looped.

### Source types
- **Generated** — sine / square / sawtooth / triangle / pulse (with pulse width).
- **Custom** — a full bezier **curve editor** (pen / select / anchor tools, handles,
  pan / zoom). The audible wave is the curve's *true profile* (upper silhouette).
- **Combined** — stack and blend other sources (add / subtract / multiply / divide /
  max / min), each with its own frequency, amplitude, blend mode, and enable toggle.
- **Shaped** — sculpt a base wave with vector shapes (boolean add / subtract) using a
  scanline height-field.
- **Gradient** — morph across the cycle between source "stops", each with its own
  frequency and enable toggle.
- **Sampled** — import an audio file, trim it, normalize it, preview it, and adopt its
  natural duration as the sampler base length.

Sources can **reference other sources** (combiner inputs, gradient stops, envelope
stages), with automatic cycle-prevention so you can't create an infinite loop.

### Custom envelope
The amplitude envelope is itself built from your sources: up to three staged curves —
**attack**, **sustain**, **release** — each referencing any source plus a length knob
and a "curve strength" blend. Drawn shapes author both timbres *and* envelopes.

### Play it
- **Web MIDI** hardware keyboards (Chromium / Firefox), with the last-used device
  auto-reconnected on return visits.
- An **on-screen piano** and **computer-keyboard** mapping (Z row = low octave,
  Q row = high octave).

### Persistence
Autosaves to `localStorage` (project, window layout, and synth settings) and supports
**New / Import / Export** of the whole session as JSON from the top bar.

---

## 🚀 Getting started

```sh
npm install
npm run dev      # dev server with hot reload
npm run build    # production build (relative asset paths)
npm run preview  # preview the production build
```

The build uses relative asset paths (`base: './'`), so it can be hosted at a server
root or under a subpath like GitHub Pages with no extra config.

---

## 🎹 First run

Browsers require a user gesture before audio can start, so the app shows a one-click
**"Enter"** gate. That single click enables audio, requests MIDI, and selects your
last-used MIDI device. On return visits the device reconnects automatically (audio
still needs the one click, per browser policy).

Safari has no Web MIDI — it falls back to the on-screen piano and computer keyboard.

---

## 🧱 Tech stack

| Piece | Used for |
|-------|----------|
| Vue 3 + Vite | App framework & build |
| Tone.js | Audio context unlock + master output (voices are native Web Audio) |
| fft.js | Time-domain cycle → band-limited `PeriodicWave` coefficients |
| bezier-js | Curve projection / editing math for the curve editor |
| vue-win-mgr | Dockable / tabbed / floating window manager + top bar |
| material-symbols | UI icons (bundled locally) |
| SCSS | Component styling |

State lives in plain OOP classes (`src/classes`, `src/audio`, `src/input`) holding
Vue reactivity refs as members — no global store — so the model is easy to serialize
and reason about outside of components.

---

## 📁 Project layout

```
src/
  classes/        App + Project state, WaveSource subclasses, curve tools
  audio/          Synth (oscillator + sampler engines), Envelope, FFT helpers
  input/          Web MIDI + computer-keyboard input
  components/     Editors (curve / combiner / shaper / gradient / sampler / envelope),
                  reusable widgets, and window components
  App.vue         Root: window manager, layout, top bar, audio gate
```

---

## 📜 License

MIT · by [Greg Miller](https://gregmiller.online)
