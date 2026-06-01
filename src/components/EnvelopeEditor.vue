<!--
	EnvelopeEditor.vue
	------------------

	The synth's amplitude envelope, built from up to three optional stages that
	each reference one of your existing sources plus a length in seconds:

		- Attack:  a source curve played once on note-on (the 0 -> sustain rise)
		- Sustain: held while the key is down (v1 = flat hold at the attack's end
		           level; a looping sustain curve is coming)
		- Release: a source curve played once on note-off, ending in silence

	A source's -1..1 curve maps to a 0..1 level via (v+1)/2 (bottom = silent).
	A stage with no source is a straight linear ramp over its length. Each stage
	with a source also has a "Curve" (strength) knob that blends from a straight
	ramp (0%) to the full curve shape (100%), keeping the endpoints fixed. The
	release always starts from the level at the moment the key is let go.

	A stitched preview shows the assembled envelope over time.
-->
<script setup>

// vue
import { inject, computed, ref, onMounted, onBeforeUnmount } from "vue";

// reusable knob
import Knob from "@/components/widgets/Knob.vue";

// shared app state -> the synth-wide envelope + source list
const app = inject("app");
const env = app.envelope;

// preview pixel size
const vw = ref(560);
const vh = ref(150);
const svgEl = ref(null);
let resizeObserver = null;

// available sources to reference (all of them)
const sources = computed(() => app.sources.value);

// reactive stage descriptors
const attack = computed(() => env.attack.value);
const release = computed(() => env.release.value);

/**
 * Percentage label for a 0..1 strength.
 *
 * @param {Number} v - 0..1
 * @returns {Number}
 */
function pct(v) {
	return Math.round(v * 100);
}

/**
 * Toggles a stage on/off.
 *
 * @param {String} name - stage name
 * @param {Boolean} enabled - new enabled state
 * @returns {void}
 */
function setEnabled(name, enabled) {
	env.setStage(name, { enabled });
	app.requestSave();
}

/**
 * Sets a stage's referenced source ("" -> linear, no source).
 *
 * @param {String} name - stage name
 * @param {String} value - source id or ""
 * @returns {void}
 */
function setSource(name, value) {
	env.setStage(name, { sourceId: value || null });
	app.requestSave();
}

/**
 * Sets a stage's length (seconds).
 *
 * @param {String} name - stage name
 * @param {Number} v - seconds
 * @returns {void}
 */
function setLength(name, v) {
	env.setStage(name, { length: v });
	app.requestSave();
}

/**
 * Sets a stage's curve strength (0..1).
 *
 * @param {String} name - stage name
 * @param {Number} v - 0..1
 * @returns {void}
 */
function setStrength(name, v) {
	env.setStage(name, { strength: v });
	app.requestSave();
}

// --- preview ----------------------------------------------------------------

const PAD = 8;
const PREVIEW_RES = 96;

/**
 * Preview x (0..1) -> pixel x.
 *
 * @param {Number} x - 0..1
 * @returns {Number}
 */
function px(x) {
	return PAD + x * (vw.value - 2 * PAD);
}

/**
 * Level (0..1) -> pixel y.
 *
 * @param {Number} y - 0..1
 * @returns {Number}
 */
function py(y) {
	return (vh.value - PAD) - y * (vh.value - 2 * PAD);
}

/**
 * Builds the stitched envelope shape (attack | flat sustain | release).
 *
 * @returns {{points:String, splitA:Number, splitB:Number}}
 */
const preview = computed(() => {

	const a = env.attack.value;
	const r = env.release.value;
	const aLen = a.enabled ? a.length : 0;
	const rLen = r.enabled ? r.length : 0.02;
	const sLen = 0.25 * (aLen + rLen) + 0.15;   // nominal sustain width (visual only)
	const total = Math.max(0.001, aLen + sLen + rLen);

	const hold = env.holdLevel();
	const aAmp = env.stageCurve("attack", PREVIEW_RES);
	const rAmp = env.stageCurve("release", PREVIEW_RES);

	const pts = [];

	if (aLen > 0) {
		for (let i = 0; i <= PREVIEW_RES; i++) {
			const f = i / PREVIEW_RES;
			const t = f * aLen;
			const lvl = aAmp ? aAmp[Math.min(PREVIEW_RES - 1, Math.floor(f * PREVIEW_RES))] : f * hold;
			pts.push([t / total, lvl]);
		}
	} else {
		pts.push([0, hold]);
	}

	const sStart = aLen;
	pts.push([sStart / total, hold]);
	pts.push([(sStart + sLen) / total, hold]);

	const rStart = sStart + sLen;
	for (let i = 0; i <= PREVIEW_RES; i++) {
		const f = i / PREVIEW_RES;
		const t = rStart + f * rLen;
		let lvl;
		if (rAmp) {
			const r0 = rAmp[0];
			const scale = r0 > 1e-4 ? hold / r0 : 0;
			lvl = Math.max(0, rAmp[Math.min(PREVIEW_RES - 1, Math.floor(f * PREVIEW_RES))] * scale);
			if (i === PREVIEW_RES)
				lvl = 0;
		} else {
			lvl = hold * (1 - f);
		}
		pts.push([t / total, lvl]);
	}

	const points = pts.map(([x, y]) => `${px(x).toFixed(1)},${py(y).toFixed(1)}`).join(" ");
	return {
		points,
		splitA: px(sStart / total),
		splitB: px(rStart / total)
	};
});

const fillPoints = computed(() => `${px(0).toFixed(1)},${py(0).toFixed(1)} ${preview.value.points} ${px(1).toFixed(1)},${py(0).toFixed(1)}`);

onMounted(() => {
	const el = svgEl.value;
	const measure = () => {
		const rect = el.getBoundingClientRect();
		if (rect.width)
			vw.value = rect.width;
		if (rect.height)
			vh.value = rect.height;
	};
	measure();
	resizeObserver = new ResizeObserver(measure);
	resizeObserver.observe(el);
});

onBeforeUnmount(() => {
	if (resizeObserver)
		resizeObserver.disconnect();
});

</script>
<template>

	<div class="envelope-editor">

		<div class="preview-wrap">
			<svg ref="svgEl" class="preview" :viewBox="`0 0 ${vw} ${vh}`" preserveAspectRatio="none">
				<rect x="0" y="0" :width="vw" :height="vh" class="bg" />
				<line x1="0" :y1="py(0)" :x2="vw" :y2="py(0)" class="axis" />
				<line x1="0" :y1="py(1)" :x2="vw" :y2="py(1)" class="axis faint" />

				<line :x1="preview.splitA" y1="0" :x2="preview.splitA" :y2="vh" class="divider" />
				<line :x1="preview.splitB" y1="0" :x2="preview.splitB" :y2="vh" class="divider" />

				<polygon :points="fillPoints" class="fill" />
				<polyline :points="preview.points" class="line" fill="none" />
			</svg>
			<div class="stage-tags" aria-hidden="true">
				<span>Attack</span><span>Sustain</span><span>Release</span>
			</div>
		</div>

		<div class="rows">

			<div class="row" :class="{ disabled: !attack.enabled }">
				<input class="enable" type="checkbox" :checked="attack.enabled" title="Enable attack" @change="setEnabled('attack', $event.target.checked)" />
				<span class="rlabel">Attack</span>
				<select class="src" :value="attack.sourceId || ''" @change="setSource('attack', $event.target.value)">
					<option value="">Linear</option>
					<option v-for="s in sources" :key="s.id" :value="s.id">{{ s.name.value }}</option>
				</select>
				<div class="knobs">
					<div v-if="attack.sourceId" class="knob-cell">
						<span class="klabel">Curve</span>
						<Knob :model-value="attack.strength" :min="0" :max="1" :curve="1" @update:model-value="setStrength('attack', $event)" />
						<span class="kval">{{ pct(attack.strength) }}%</span>
					</div>
					<div class="knob-cell">
						<span class="klabel">Len</span>
						<Knob :model-value="attack.length" :min="0.005" :max="4" :curve="3" @update:model-value="setLength('attack', $event)" />
						<span class="kval">{{ attack.length.toFixed(3) }}s</span>
					</div>
				</div>
			</div>

			<div class="row sustain">
				<span class="rlabel">Sustain</span>
				<span class="note">Flat hold at the attack's end level. Looping sustain curve coming soon.</span>
			</div>

			<div class="row" :class="{ disabled: !release.enabled }">
				<input class="enable" type="checkbox" :checked="release.enabled" title="Enable release" @change="setEnabled('release', $event.target.checked)" />
				<span class="rlabel">Release</span>
				<select class="src" :value="release.sourceId || ''" @change="setSource('release', $event.target.value)">
					<option value="">Linear</option>
					<option v-for="s in sources" :key="s.id" :value="s.id">{{ s.name.value }}</option>
				</select>
				<div class="knobs">
					<div v-if="release.sourceId" class="knob-cell">
						<span class="klabel">Curve</span>
						<Knob :model-value="release.strength" :min="0" :max="1" :curve="1" @update:model-value="setStrength('release', $event)" />
						<span class="kval">{{ pct(release.strength) }}%</span>
					</div>
					<div class="knob-cell">
						<span class="klabel">Len</span>
						<Knob :model-value="release.length" :min="0.005" :max="4" :curve="3" @update:model-value="setLength('release', $event)" />
						<span class="kval">{{ release.length.toFixed(3) }}s</span>
					</div>
				</div>
			</div>

		</div>

		<p class="hint">Stages reference your sources (mapped so the bottom of a curve = silent). "Linear" = a straight ramp; Curve blends ramp → full shape.</p>

	</div>

</template>
<style lang="scss" scoped>

	.envelope-editor {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.preview-wrap {
		position: relative;
	}

	.preview {
		display: block;
		width: 100%;
		height: 150px;
		background: #0a0a0c;
		border: 1px solid #2c2c32;
		border-radius: 6px;
	}

	.stage-tags {
		display: flex;
		justify-content: space-around;
		margin-top: 2px;

		span {
			font-size: 10px;
			text-transform: uppercase;
			letter-spacing: 0.06em;
			color: #777;
		}
	}

	.bg { fill: transparent; }
	.axis { stroke: rgba(255, 255, 255, 0.14); stroke-width: 1; }
	.axis.faint { stroke: rgba(255, 255, 255, 0.06); }
	.divider { stroke: rgba(224, 179, 77, 0.5); stroke-width: 1; stroke-dasharray: 4 4; }
	.fill { fill: var(--accent-dim); }
	.line { stroke: var(--accent); stroke-width: 2; }

	.rows {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.row {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 8px 10px;
		background: #1e1e22;
		border: 1px solid #2c2c32;
		border-radius: 6px;

		&.disabled { opacity: 0.5; }

		.enable {
			flex: 0 0 auto;
			width: 15px;
			height: 15px;
			accent-color: var(--accent);
			cursor: pointer;
		}

		.rlabel {
			flex: 0 0 64px;
			font-size: 12px;
			text-transform: uppercase;
			letter-spacing: 0.05em;
			color: #aaa;
		}

		.src {
			flex: 0 1 200px;
			background: #26262c;
			color: #ddd;
			border: 1px solid #444;
			border-radius: 4px;
			padding: 4px 6px;
		}

		.knobs {
			display: flex;
			align-items: center;
			gap: 16px;
			margin-left: auto;
		}

		.knob-cell {
			display: flex;
			align-items: center;
			gap: 6px;

			.klabel {
				font-size: 11px;
				text-transform: uppercase;
				letter-spacing: 0.05em;
				color: #999;
			}

			.kval {
				font-size: 12px;
				color: #ccc;
				font-variant-numeric: tabular-nums;
				min-width: 46px;
				text-align: right;
			}
		}

		&.sustain .note {
			font-size: 11px;
			color: #777;
		}
	}

	.hint { margin: 0; font-size: 11px; color: #666; }

</style>
