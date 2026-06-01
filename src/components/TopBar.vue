<!--
	TopBar.vue
	----------

	The WindowManager top-bar content (provided via its #topBar slot). File
	operations on the left (New / Import / Export of the whole session), a centered
	app title, and external links (GitHub repo + author site) as icons on the
	right. These file controls used to live in the Sources window; they sit more
	naturally up here.
-->
<script setup>

// vue
import { inject, ref } from "vue";

// shared app state
const app = inject("app");

// hidden file input for import
const fileInput = ref(null);

/**
 * Clears the project after confirmation.
 *
 * @returns {void}
 */
function newProject() {
	if (typeof window === "undefined" || window.confirm("Start a new project? This clears all current sources."))
		app.newProject();
}

/**
 * Downloads the current session as JSON.
 *
 * @returns {void}
 */
function exportProject() {
	app.exportProject();
}

/**
 * Opens the file picker for import.
 *
 * @returns {void}
 */
function triggerImport() {
	if (fileInput.value)
		fileInput.value.click();
}

/**
 * Imports the chosen JSON file, then resets the input.
 *
 * @param {Event} event - file input change event
 * @returns {void}
 */
function onImportChange(event) {
	const file = event.target.files && event.target.files[0];
	if (file)
		app.importFromFile(file);
	event.target.value = "";
}

</script>
<template>

	<div class="top-bar">

		<div class="left">
			<button type="button" @click="newProject">New</button>
			<button type="button" @click="triggerImport">Import</button>
			<button type="button" @click="exportProject">Export</button>
			<input ref="fileInput" type="file" accept="application/json" hidden @change="onImportChange" />
		</div>

		<div class="center">
			<span class="title">Web Synth</span>
		</div>

		<div class="right">
			<a class="icon" href="https://github.com/orokro/web-synth-demo" target="_blank" rel="noopener noreferrer" title="GitHub repository">
				<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
					<path fill="currentColor" d="M12 .5C5.73.5.5 5.73.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.56 0-.28-.01-1.02-.02-2-3.2.7-3.88-1.54-3.88-1.54-.53-1.34-1.3-1.7-1.3-1.7-1.06-.72.08-.71.08-.71 1.17.08 1.79 1.2 1.79 1.2 1.04 1.78 2.73 1.27 3.4.97.11-.75.41-1.27.74-1.56-2.55-.29-5.23-1.28-5.23-5.69 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11.1 11.1 0 0 1 5.8 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.84 1.19 3.1 0 4.42-2.69 5.39-5.25 5.68.42.36.79 1.08.79 2.18 0 1.58-.01 2.85-.01 3.24 0 .31.21.68.8.56A11.51 11.51 0 0 0 23.5 12C23.5 5.73 18.27.5 12 .5z" />
				</svg>
			</a>
			<a class="icon" href="https://gregmiller.online" target="_blank" rel="noopener noreferrer" title="gregmiller.online">
				<span class="material-symbols-outlined">language</span>
			</a>
		</div>

	</div>

</template>
<style lang="scss" scoped>

	.top-bar {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		height: 100%;
		padding: 0 10px;
		color: #ddd;
		font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
	}

	.left {
		display: flex;
		gap: 6px;
		flex: 0 0 auto;

		button {
			padding: 4px 12px;
			font-size: 12px;
			border: 1px solid #444;
			border-radius: 4px;
			background: #2a2a30;
			color: #ccc;
			cursor: pointer;

			&:hover {
				background: #34343c;
				color: #fff;
			}
		}
	}

	.center {
		flex: 1 1 auto;
		text-align: center;
		min-width: 0;

		.title {
			font-size: 13px;
			font-weight: 600;
			letter-spacing: 0.04em;
			color: #e8e8e8;
		}
	}

	.right {
		display: flex;
		align-items: center;
		gap: 4px;
		flex: 0 0 auto;

		.icon {
			display: inline-flex;
			align-items: center;
			justify-content: center;
			width: 28px;
			height: 28px;
			border-radius: 4px;
			color: #aaa;
			text-decoration: none;

			.material-symbols-outlined { font-size: 20px; }

			&:hover {
				color: #fff;
				background: rgba(255, 255, 255, 0.08);
			}
		}
	}

</style>
