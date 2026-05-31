<!--
	App.vue
	-------

	Root component. Instantiates the shared App state, provides it for injection
	into every window, and mounts the vue-win-mgr WindowManager with the set of
	available windows and a default layout (Sources sidebar, Editor main, Synth
	and Instrument across the bottom). The window manager handles splitting,
	tabbing, floating and resizing from there.
-->
<script setup>

// vue
import { onMounted, onBeforeUnmount, provide, ref } from "vue";

// window manager library
import { WindowManager, FRAME_STYLE } from "vue-win-mgr";
import "vue-win-mgr/dist/style.css";

// shared app state
import App from "@/classes/App.js";

// window components
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

onMounted(() => {
	app.attachComputerKeyboard();
	app.setWindowManagerContext(windowManagerEl.value?.getContext?.() ?? null);
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
			:showTopBar="false"
			:showStatusBar="false"
			:splitMergeHandles="true"
			:theme="{
				frameTabsActiveColor: 'rgb(105,105,105)'
			}"
		/>
	</main>

</template>
<style>

	/* base reset (global, intentionally not scoped) */
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

</style>
