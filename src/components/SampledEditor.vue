<!--
	SampledEditor.vue
	-----------------

	Editor body for a sampled wave source. Imports an audio file (decoded to mono
	via a lazy AudioContext), shows a min/max waveform envelope with two draggable
	trim handles selecting the used region, and reports the file name + natural
	(trimmed) duration. A "Set base length" button adopts that duration as the
	synth's sampler base length so the sample plays back at its original speed. A
	"Normalize" button stretches the amplitude to full scale (non-destructive).

	The waveform is drawn on a canvas (cheap for long buffers); trim handles are
	overlaid as absolutely-positioned bars dragged in normalized 0..1 space.
-->
<script setup>

// vue
import { inject, ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from "vue";

// shared app state (for "Set base length")
const app = inject("app");

const props = defineProps({
	source: {
		type: Object,
		required: true
	}
});

// hidden file input + the canvas we draw the envelope into
const fileInput = ref(null);
const canvasEl = ref(null);

// import progress / error feedback
const busy = ref(false);
const error = ref("");

// whether a preview is currently sounding
const playing = ref(false);

// lazily-created context for decoding (separate from the synth graph)
let decodeCtx = null;

// trimmed duration readout, reactive on trim edits + new imports
const duration = computed(() => {
	void props.source.version.value;
	void props.source.trimStart.value;
	void props.source.trimEnd.value;
	return props.source.naturalDuration();
});

// whether the source actually has audio loaded
const hasAudio = computed(() => {
	void props.source.version.value;
	return props.source.mono && props.source.mono.length > 1;
});

/**
 * Opens the file picker.
 *
 * @returns {void}
 */
function triggerImport() {
	if (fileInput.value)
		fileInput.value.click();
}

/**
 * Decodes the chosen audio file to mono and loads it into the source.
 *
 * @param {Event} event - file input change event
 * @returns {Promise<void>}
 */
async function onFileChange(event) {

	const file = event.target.files && event.target.files[0];
	event.target.value = "";
	if (!file)
		return;

	busy.value = true;
	error.value = "";

	try {
		const buf = await file.arrayBuffer();
		if (!decodeCtx)
			decodeCtx = new (window.AudioContext || window.webkitAudioContext)();
		const audio = await decodeCtx.decodeAudioData(buf);
		const mono = mixToMono(audio);
		props.source.setAudio(mono, audio.sampleRate, file.name);
		await nextTick();
		draw();
	} catch (err) {
		error.value = "Couldn't decode that file.";
	} finally {
		busy.value = false;
	}
}

/**
 * Mixes an AudioBuffer's channels down to a single mono Float32Array.
 *
 * @param {AudioBuffer} audio - decoded audio buffer
 * @returns {Float32Array}
 */
function mixToMono(audio) {

	const n = audio.length;
	const out = new Float32Array(n);
	const channels = audio.numberOfChannels;

	for (let c = 0; c < channels; c++) {
		const data = audio.getChannelData(c);
		for (let i = 0; i < n; i++)
			out[i] += data[i];
	}
	if (channels > 1)
		for (let i = 0; i < n; i++)
			out[i] /= channels;

	return out;
}

/**
 * Draws the mono buffer as a min/max envelope onto the canvas.
 *
 * @returns {void}
 */
function draw() {

	const canvas = canvasEl.value;
	if (!canvas)
		return;

	const rect = canvas.getBoundingClientRect();
	const w = Math.max(1, Math.floor(rect.width));
	const h = Math.max(1, Math.floor(rect.height));
	const dpr = window.devicePixelRatio || 1;
	canvas.width = w * dpr;
	canvas.height = h * dpr;

	const ctx = canvas.getContext("2d");
	ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
	ctx.clearRect(0, 0, w, h);

	const mono = props.source.mono;
	const mid = h / 2;

	// zero line
	ctx.strokeStyle = "#2c2c32";
	ctx.lineWidth = 1;
	ctx.beginPath();
	ctx.moveTo(0, mid);
	ctx.lineTo(w, mid);
	ctx.stroke();

	if (!mono || mono.length < 2)
		return;

	// per-pixel min/max envelope (gain applied so the view matches the output)
	const gain = props.source.gain.value;
	const per = mono.length / w;
	ctx.strokeStyle = "#00ABAE";
	ctx.lineWidth = 1;
	ctx.beginPath();
	for (let x = 0; x < w; x++) {
		const start = Math.floor(x * per);
		const end = Math.min(mono.length, Math.floor((x + 1) * per));
		let lo = 1;
		let hi = -1;
		for (let i = start; i < end; i++) {
			const v = mono[i];
			if (v < lo) lo = v;
			if (v > hi) hi = v;
		}
		if (start >= end)
			lo = hi = 0;
		hi *= gain;
		lo *= gain;
		ctx.moveTo(x + 0.5, mid - Math.max(-1, Math.min(1, hi)) * mid);
		ctx.lineTo(x + 0.5, mid - Math.max(-1, Math.min(1, lo)) * mid);
	}
	ctx.stroke();
}

// --- trim handle dragging ----------------------------------------------------

// which handle is being dragged ("start" | "end" | null)
const dragging = ref(null);

/**
 * Begins dragging a trim handle.
 *
 * @param {String} which - "start" or "end"
 * @param {Event} event - pointer down event
 * @returns {void}
 */
function startDrag(which, event) {
	dragging.value = which;
	event.preventDefault();
	window.addEventListener("pointermove", onDrag);
	window.addEventListener("pointerup", endDrag);
}

/**
 * Updates the dragged handle from the pointer position.
 *
 * @param {PointerEvent} event - pointer move event
 * @returns {void}
 */
function onDrag(event) {

	if (!dragging.value || !canvasEl.value)
		return;

	const rect = canvasEl.value.getBoundingClientRect();
	let t = (event.clientX - rect.left) / rect.width;
	t = t < 0 ? 0 : t > 1 ? 1 : t;

	const gap = 0.001;
	if (dragging.value === "start")
		props.source.trimStart.value = Math.min(t, props.source.trimEnd.value - gap);
	else
		props.source.trimEnd.value = Math.max(t, props.source.trimStart.value + gap);
}

/**
 * Ends a trim-handle drag.
 *
 * @returns {void}
 */
function endDrag() {
	dragging.value = null;
	window.removeEventListener("pointermove", onDrag);
	window.removeEventListener("pointerup", endDrag);
	app.requestSave();
}

/**
 * Adopts the sample's natural (trimmed) duration as the synth base length.
 *
 * @returns {void}
 */
function setBaseLength() {
	const d = props.source.naturalDuration();
	if (d > 0)
		app.synth.setBaseLength(d);
}

/**
 * Normalizes the sample so the trimmed region peaks at full scale.
 *
 * @returns {void}
 */
function normalize() {
	props.source.normalize();
	app.requestSave();
}

/**
 * Auditions the trimmed sample through the synth's output. Toggles: a second
 * click (or end of playback) stops it. Enables audio first if needed.
 *
 * @returns {Promise<void>}
 */
async function togglePreview() {

	if (playing.value) {
		app.synth.stopPreview();
		playing.value = false;
		return;
	}

	if (!app.synth.isStarted.value)
		await app.enableAudio();

	const data = props.source.renderNatural();
	if (!data.length)
		return;

	playing.value = true;
	app.synth.previewBuffer(data, props.source.sampleRate, () => {
		playing.value = false;
	});
}

// redraw whenever the audio buffer or gain changes
watch(() => [props.source.version.value, props.source.gain.value], () => nextTick(draw));

// keep the envelope crisp on resize
let resizeObserver = null;
onMounted(() => {
	draw();
	if (typeof ResizeObserver !== "undefined" && canvasEl.value) {
		resizeObserver = new ResizeObserver(() => draw());
		resizeObserver.observe(canvasEl.value);
	}
});
onBeforeUnmount(() => {
	app.synth.stopPreview();
	if (resizeObserver)
		resizeObserver.disconnect();
	window.removeEventListener("pointermove", onDrag);
	window.removeEventListener("pointerup", endDrag);
});

</script>
<template>

	<div class="sampled-editor">

		<div class="toolbar">
			<button type="button" class="import" :disabled="busy" @click="triggerImport">
				{{ busy ? "Decoding…" : "Import audio" }}
			</button>
			<span v-if="source.fileName.value" class="file">{{ source.fileName.value }}</span>
			<span v-else class="file none">No file loaded</span>
			<input ref="fileInput" type="file" accept="audio/*" hidden @change="onFileChange" />
		</div>

		<p v-if="error" class="error">{{ error }}</p>

		<div class="wave">
			<canvas ref="canvasEl" class="canvas"></canvas>

			<template v-if="hasAudio">
				<div class="trim left" :style="{ width: (source.trimStart.value * 100) + '%' }"></div>
				<div class="trim right" :style="{ width: ((1 - source.trimEnd.value) * 100) + '%' }"></div>

				<div
					class="handle"
					:class="{ active: dragging === 'start' }"
					:style="{ left: (source.trimStart.value * 100) + '%' }"
					@pointerdown="startDrag('start', $event)"
				></div>
				<div
					class="handle"
					:class="{ active: dragging === 'end' }"
					:style="{ left: (source.trimEnd.value * 100) + '%' }"
					@pointerdown="startDrag('end', $event)"
				></div>
			</template>

			<span v-else class="hint">Import an audio file to begin.</span>
		</div>

		<div class="info">
			<span class="dur">Trimmed length: <strong>{{ duration.toFixed(3) }} s</strong></span>
			<div class="actions">
				<button type="button" class="action play" :disabled="!hasAudio" @click="togglePreview">
					{{ playing ? "Stop" : "Play" }}
				</button>
				<button type="button" class="action" :disabled="!hasAudio" title="Stretch amplitude to full scale" @click="normalize">
					Normalize
				</button>
				<button type="button" class="action" :disabled="!hasAudio" @click="setBaseLength">
					Set as base length
				</button>
			</div>
		</div>

	</div>

</template>
<style lang="scss" scoped>

	.sampled-editor {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.toolbar {
		display: flex;
		align-items: center;
		gap: 12px;

		.import {
			padding: 7px 14px;
			border: 1px solid #444;
			border-radius: 5px;
			background: #26262c;
			color: #ddd;
			cursor: pointer;

			&:hover:not(:disabled) { background: #34343c; }
			&:disabled { opacity: 0.6; cursor: default; }
		}

		.file {
			font-size: 12px;
			color: #bbb;
			white-space: nowrap;
			overflow: hidden;
			text-overflow: ellipsis;

			&.none { color: #666; }
		}
	}

	.error { margin: 0; font-size: 12px; color: #e06b6b; }

	.wave {
		position: relative;
		width: 100%;
		height: 160px;
		background: #0a0a0c;
		border: 1px solid #2c2c32;
		border-radius: 6px;
		overflow: hidden;

		.canvas {
			position: absolute;
			inset: 0;
			width: 100%;
			height: 100%;
		}

		.trim {
			position: absolute;
			top: 0;
			bottom: 0;
			background: rgba(0, 0, 0, 0.62);
			pointer-events: none;

			&.left { left: 0; }
			&.right { right: 0; }
		}

		.handle {
			position: absolute;
			top: 0;
			bottom: 0;
			width: 9px;
			margin-left: -4px;
			cursor: ew-resize;
			background: transparent;

			&::before {
				content: "";
				position: absolute;
				top: 0;
				bottom: 0;
				left: 4px;
				width: 1px;
				background: var(--accent);
			}

			&::after {
				content: "";
				position: absolute;
				top: 50%;
				left: 0;
				width: 9px;
				height: 18px;
				margin-top: -9px;
				border-radius: 2px;
				background: var(--accent);
				box-shadow: 0 0 4px var(--accent);
			}

			&:hover::before, &.active::before { background: var(--accent-bright); }
		}

		.hint {
			position: absolute;
			inset: 0;
			display: flex;
			align-items: center;
			justify-content: center;
			font-size: 13px;
			color: #555;
		}
	}

	.info {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;

		.dur {
			font-size: 12px;
			color: #aaa;

			strong { color: #ddd; }
		}

		.actions {
			display: flex;
			gap: 8px;
		}

		.action.play {
			border-color: var(--accent-border);
			color: var(--accent);
		}

		.action {
			padding: 6px 12px;
			border: 1px solid #444;
			border-radius: 5px;
			background: #26262c;
			color: #ddd;
			cursor: pointer;

			&:hover:not(:disabled) { background: #34343c; }
			&:disabled { opacity: 0.5; cursor: default; }
		}
	}

</style>
