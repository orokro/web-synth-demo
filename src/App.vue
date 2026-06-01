<!--
	App.vue
	-------

	Root component. Instantiates the shared App state, provides it for injection
	into every window, and mounts the vue-win-mgr WindowManager with the set of
	available windows and a default layout (Sources sidebar, Editor main, Synth
	and Instrument across the bottom). A custom top bar (file ops + title + links)
	is supplied via the manager's #topBar slot.

	On load it tries to silently resume audio + reconnect MIDI; browsers require a
	user gesture to start audio, so an "Enter" gate covers the (usually) one click
	needed — a single click enables audio and connects the last MIDI device.

	Global styles here also define the app accent palette as CSS variables and a
	box-sizing reset so borders never push children past their containers.
-->
<script setup>

// vue
import { onMounted, onBeforeUnmount, provide, ref } from "vue";

// window manager library
import { WindowManager, FRAME_STYLE } from "vue-win-mgr";
import "vue-win-mgr/dist/style.css";

// shared app state
import App from "@/classes/App.js";

// top bar + window components
import TopBar from "@/components/TopBar.vue";
import SourcesWindow from "@/components/windows/SourcesWindow.vue";
import EditorWindow from "@/components/windows/EditorWindow.vue";
import SynthWindow from "@/components/windows/SynthWindow.vue";
import InstrumentWindow from "@/components/windows/InstrumentWindow.vue";

// the one shared application state instance
const app = new App();
provide("app", app);

// ref to the window manager element, for its JS context
const windowManagerEl = ref(null);

// windows the manager is allowed to host
const availableWindows = [
	{ window: SourcesWindow, title: "Sources", slug: "sources" },
	{ window: EditorWindow, title: "Editor", slug: "editor" },
	{ window: SynthWindow, title: "Synth", slug: "synth" },
	{ window: InstrumentWindow, title: "Instrument", slug: "instrument" }
];

// default layout, authored in a 1920x1080 reference space
const layout = [
	{
		name: "window",
		top: 0,
		left: 0,
		bottom: 1080,
		right: 1920
	},
	{
		name: "sources",
		windows: ["sources"],
		style: FRAME_STYLE.TABBED,
		left: 0,
		right: 280,
		top: 0,
		bottom: ["ref", "window.bottom"]
	},
	{
		name: "editor",
		windows: ["editor"],
		style: FRAME_STYLE.TABBED,
		left: ["ref", "sources.right"],
		right: ["ref", "window.right"],
		top: 0,
		bottom: ["ref", "window.bottom-340"]
	},
	{
		name: "synth",
		windows: ["synth"],
		style: FRAME_STYLE.TABBED,
		left: ["ref", "sources.right"],
		right: ["ref", "sources.right+560"],
		top: ["ref", "editor.bottom"],
		bottom: ["ref", "window.bottom"]
	},
	{
		name: "instrument",
		windows: ["instrument"],
		style: FRAME_STYLE.TABBED,
		left: ["ref", "synth.right"],
		right: ["ref", "window.right"],
		top: ["ref", "editor.bottom"],
		bottom: ["ref", "window.bottom"]
	}
];

/**
 * Disables the browser context menu (unless Shift is held, for debugging).
 *
 * @param {Event} event - the contextmenu event
 * @returns {void}
 */
function disableContextMenu(event) {
	if (event.shiftKey === false)
		event.preventDefault();
}

/**
 * The audio gate's click: enables audio + connects MIDI from this user gesture.
 *
 * @returns {void}
 */
function enterApp() {
	app.enableAudio();
}

onMounted(() => {
	app.attachComputerKeyboard();
	app.setWindowManagerContext(windowManagerEl.value?.getContext?.() ?? null);
	app.tryAutoEnable();
	window.synthApp = app;
});

onBeforeUnmount(() => {
	app.dispose();
});

</script>
<template>

	<main class="app-root" @contextmenu="disableContextMenu">
		<WindowManager
			ref="windowManagerEl"
			:availableWindows="availableWindows"
			:defaultLayout="layout"
			:showTopBar="true"
			:showStatusBar="false"
			:splitMergeHandles="true"
			:theme="{
				frameTabsActiveColor: 'rgb(105,105,105)',
				topBarBGColor: '#101013'
			}"
		>
			<template #topBar>
				<TopBar />
			</template>
		</WindowManager>

		<div v-if="!app.synth.isStarted.value" class="audio-gate" @click="enterApp">
			<div class="card">
				<h1>Web Synth</h1>
				<p>Click to enable audio<span v-if="app.midiInput.isSupported.value"> and connect MIDI</span>.</p>
				<button type="button">Enter</button>
			</div>
		</div>
	</main>

</template>
<style>

	/* box-sizing reset so borders never overflow their containers */
	*, *::before, *::after {
		box-sizing: border-box;
	}

	/* app accent palette */
	:root {
		--accent: #00ABAE;
		--accent-bright: #1fd0d3;
		--accent-dark: #007a7c;
		--accent-dim: rgba(0, 171, 174, 0.18);
		--accent-border: rgba(0, 171, 174, 0.55);
		--accent-on: #04302f;
	}

	html, body, #app {
		height: 100%;
		margin: 0;
	}

	body {
		font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
		background: #121214;
	}

</style>
<style lang="scss" scoped>

	.app-root {
		position: absolute;
		inset: 0;
		overflow: hidden;
	}

	.audio-gate {
		position: absolute;
		inset: 0;
		z-index: 1000;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(10, 10, 12, 0.86);
		backdrop-filter: blur(3px);
		cursor: pointer;

		.card {
			text-align: center;
			padding: 28px 40px;
			border: 1px solid var(--accent-border);
			border-radius: 10px;
			background: #17171a;
			box-shadow: 0 10px 40px rgba(0, 0, 0, 0.6);

			h1 {
				margin: 0 0 8px;
				font-size: 22px;
				color: var(--accent);
				letter-spacing: 0.04em;
			}

			p {
				margin: 0 0 18px;
				font-size: 13px;
				color: #bbb;
			}

			button {
				padding: 9px 26px;
				border: none;
				border-radius: 6px;
				background: var(--accent);
				color: var(--accent-on);
				font-size: 14px;
				font-weight: 600;
				cursor: pointer;

				&:hover { background: var(--accent-bright); }
			}
		}
	}

</style>
