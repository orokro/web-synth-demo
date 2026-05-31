<!--
	SourcesWindow.vue
	-----------------

	Window listing the project's wave sources, with controls to add (choosing a
	type), select and remove them, plus a live waveform thumbnail per source. A
	dot marks the source currently feeding the synth. A small toolbar handles
	New / Import / Export of the whole session. Reads shared App state so
	multiple Sources windows stay in sync. Fills its parent frame and scrolls.
-->
<script setup>

// vue
import { inject, ref, onMounted, onBeforeUnmount } from "vue";

// components
import WavePreview from "@/components/WavePreview.vue";

// shared app state
const app = inject("app");

// source type -> material symbol icon name
const TYPE_ICONS = {
	generated: "graphic_eq",
	custom: "gesture",
	combined: "layers",
	shaped: "category",
	gradient: "gradient",
	sampled: "audio_file"
};

/**
 * Icon name for a source type.
 *
 * @param {String} type - source kind slug
 * @returns {String}
 */
function typeIcon(type) {
	return TYPE_ICONS[type] || "show_chart";
}

// add-type menu state + element (for click-outside)
const showMenu = ref(false);
const addWrap = ref(null);

// hidden file input for import
const fileInput = ref(null);

// addable source types
const ADD_TYPES = [
	{ type: "generated", label: "Generated" },
	{ type: "custom", label: "Custom" }
];

/**
 * Toggles the add-type menu.
 *
 * @returns {void}
 */
function toggleMenu() {
	showMenu.value = !showMenu.value;
}

/**
 * Adds a source of the given type and closes the menu.
 *
 * @param {String} type - source kind slug
 * @returns {void}
 */
function addType(type) {
	app.addSource(type);
	showMenu.value = false;
}

/**
 * Closes the add menu when clicking outside it.
 *
 * @param {Event} event - document click event
 * @returns {void}
 */
function onDocClick(event) {
	if (showMenu.value && addWrap.value && !addWrap.value.contains(event.target))
		showMenu.value = false;
}

/**
 * Selects a source.
 *
 * @param {String} id - source id
 * @returns {void}
 */
function select(id) {
	app.selectSource(id);
}

/**
 * Removes a source without also selecting it.
 *
 * @param {String} id - source id
 * @param {Event} event - the click event
 * @returns {void}
 */
function remove(id, event) {
	event.stopPropagation();
	app.removeSource(id);
}

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

onMounted(() => document.addEventListener("click", onDocClick));
onBeforeUnmount(() => document.removeEventListener("click", onDocClick));

</script>
<template>

	<div class="sources-window">
		<header class="header">
			<h2>Sources</h2>
			<div ref="addWrap" class="add-wrap">
				<button class="add" type="button" title="Add source" @click="toggleMenu">+</button>
				<div v-if="showMenu" class="add-menu">
					<button v-for="t in ADD_TYPES" :key="t.type" type="button" @click="addType(t.type)">{{ t.label }}</button>
				</div>
			</div>
		</header>

		<div class="toolbar">
			<button type="button" @click="newProject">New</button>
			<button type="button" @click="triggerImport">Import</button>
			<button type="button" @click="exportProject">Export</button>
			<input ref="fileInput" type="file" accept="application/json" hidden @change="onImportChange" />
		</div>

		<div class="list">
			<p v-if="app.sources.value.length === 0" class="empty">No sources yet. Click + to add one.</p>

			<div
				v-for="source in app.sources.value"
				:key="source.id"
				class="item"
				:class="{ selected: source.id === app.selectedSourceId.value }"
				@click="select(source.id)"
			>
				<span class="thumb"><WavePreview :samples="source.getCycle()" /></span>

				<span class="info">
					<span class="name">{{ source.name.value }}</span>
					<span class="type"><span class="material-symbols-outlined">{{ typeIcon(source.type) }}</span>{{ source.type }}</span>
				</span>

				<span
					v-if="source.id === app.soundSourceId.value"
					class="sound-dot"
					title="Feeding the synth"
				></span>

				<button class="del" type="button" title="Remove" @click="remove(source.id, $event)">×</button>
			</div>
		</div>
	</div>

</template>
<style lang="scss" scoped>

	.sources-window {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
		background: #1e1e22;
		color: #ddd;
		border: 2px solid #696969;
	}

	.header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 8px 12px;
		border-bottom: 1px solid #2c2c32;
		flex: 0 0 auto;

		h2 {
			margin: 0;
			font-size: 12px;
			text-transform: uppercase;
			letter-spacing: 0.08em;
			color: #aaa;
		}
	}

	.add-wrap {
		position: relative;

		.add {
			width: 24px;
			height: 24px;
			border: 1px solid #444;
			border-radius: 4px;
			background: #2a2a30;
			color: #ddd;
			cursor: pointer;
			font-size: 16px;
			line-height: 1;

			&:hover {
				background: #34343c;
			}
		}

		.add-menu {
			position: absolute;
			top: 28px;
			right: 0;
			z-index: 10;
			display: flex;
			flex-direction: column;
			min-width: 120px;
			background: #26262c;
			border: 1px solid #444;
			border-radius: 5px;
			overflow: hidden;
			box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);

			button {
				padding: 8px 12px;
				border: none;
				background: transparent;
				color: #ddd;
				text-align: left;
				cursor: pointer;
				font-size: 13px;

				&:hover {
					background: var(--accent-dim);
					color: var(--accent);
				}
			}
		}
	}

	.toolbar {
		display: flex;
		gap: 6px;
		padding: 8px 12px;
		border-bottom: 1px solid #2c2c32;
		flex: 0 0 auto;

		button {
			flex: 1 1 0;
			padding: 5px 0;
			font-size: 11px;
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

	.list {
		flex: 1 1 auto;
		overflow-y: auto;
		padding: 6px;
	}

	.empty {
		margin: 8px;
		font-size: 12px;
		color: #777;
	}

	.item {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 6px 8px;
		border-radius: 5px;
		cursor: pointer;

		&:hover {
			background: #26262c;
		}

		&.selected {
			background: var(--accent-dim);
		}

		.thumb {
			flex: 0 0 auto;
			width: 46px;
			height: 28px;
			background: #111;
			border: 1px solid #3a3a42;
			border-radius: 4px;
			overflow: hidden;
		}

		.info {
			flex: 1 1 auto;
			min-width: 0;
			display: flex;
			flex-direction: column;

			.name {
				font-size: 13px;
				white-space: nowrap;
				overflow: hidden;
				text-overflow: ellipsis;
			}

			.type {
				font-size: 10px;
				color: #888;
				text-transform: uppercase;
			}
		}

		.sound-dot {
			flex: 0 0 auto;
			width: 8px;
			height: 8px;
			border-radius: 50%;
			background: var(--accent);
			box-shadow: 0 0 4px var(--accent);
		}

		.del {
			flex: 0 0 auto;
			width: 20px;
			height: 20px;
			border: none;
			border-radius: 4px;
			background: transparent;
			color: #888;
			cursor: pointer;
			font-size: 15px;
			line-height: 1;

			&:hover {
				background: rgba(255, 80, 80, 0.25);
				color: #fff;
			}
		}
	}

	.type .material-symbols-outlined {
		font-size: 14px;
		line-height: 1;
		margin-right: 3px;
		vertical-align: -2px;
		text-transform: none;
		color: var(--accent);
	}

</style>
