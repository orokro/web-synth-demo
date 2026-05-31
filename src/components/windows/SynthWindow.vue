<!--
	SynthWindow.vue
	---------------

	Window for the synth settings only (the play surface lives in the Instrument
	window). Hosts the enable-audio gate and the sound-source / envelope fields.
	The real source pickers and envelope editor arrive in later phases.
-->
<script setup>

// vue
import { inject } from "vue";

// shared app state
const app = inject("app");

/**
 * Resumes audio and requests midi access from this user gesture.
 *
 * @returns {void}
 */
function enableAudio() {
	app.enableAudio();
}

</script>
<template>

	<div class="synth-window">

		<header class="bar">
			<button
				v-if="!app.synth.isStarted.value"
				class="enable"
				type="button"
				@click="enableAudio"
			>Enable Audio</button>
			<span v-else class="enabled">Audio on</span>
		</header>

		<div class="fields">
			<div class="field">
				<span class="field-label">Sound wave</span>
				<div class="field-body">Sine (built-in) — source picker in Phase 2</div>
			</div>
			<div class="field">
				<span class="field-label">Envelope</span>
				<div class="field-body">Default ADSR — custom envelope in Phase 7</div>
			</div>
		</div>

	</div>

</template>
<style lang="scss" scoped>

	.synth-window {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
		gap: 12px;
		padding: 12px;
		background: #17171a;
		color: #ddd;
		box-sizing: border-box;
		overflow: auto;
	}

	.bar {
		display: flex;
		align-items: center;
		gap: 16px;
		flex: 0 0 auto;
	}

	.enable {
		padding: 7px 14px;
		border: none;
		border-radius: 5px;
		background: #6cc4ff;
		color: #06263a;
		font-weight: 600;
		cursor: pointer;
	}

	.enabled {
		font-size: 12px;
		color: #6cc4ff;
	}

	.fields {
		display: flex;
		flex-wrap: wrap;
		gap: 12px;

		.field {
			flex: 1 1 220px;
			background: #1e1e22;
			border: 1px solid #2c2c32;
			border-radius: 6px;
			padding: 10px;
		}

		.field-label {
			display: block;
			font-size: 11px;
			text-transform: uppercase;
			letter-spacing: 0.08em;
			color: #888;
			margin-bottom: 6px;
		}

		.field-body {
			font-size: 13px;
			color: #bbb;
		}
	}

</style>
