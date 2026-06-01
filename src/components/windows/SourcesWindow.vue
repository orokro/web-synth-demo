<!--
	SourcesWindow.vue
	-----------------

	Window listing the project's wave sources, with controls to add (choosing a
	type), select and remove them, plus a live waveform thumbnail per source. A
	dot marks the source currently feeding the synth. Double-click a name to
	rename it inline. Reads shared App state so multiple Sources windows stay in
	sync. Fills its parent frame and scrolls. (New / Import / Export of the whole
	session live in the app's top bar.)
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

// addable source types
const ADD_TYPES = [
	{ type: "generated", label: "Generated" },
	{ type: "custom", label: "Custom" },
	{ type: "combined", label: "Combined" },
	{ type: "shaped", label: "Shaped" },
	{ type: "gradient", label: "Gradient" },
	{ type: "sampled", label: "Sample" }
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

// inline-rename state: the source id being edited + its working name
const editingId = ref(null);
const editingName = ref("");

/**
 * Enters inline-rename mode for a source.
 *
 * @param {Object} source - the source to rename
 * @returns {void}
 */
function startRename(source) {
	editingId.value = source.id;
	editingName.value = source.name.value;
}

/**
 * Focuses and selects the rename input when it mounts (function ref).
 *
 * @param {HTMLInputElement|null} el - the input element (null on unmount)
 * @returns {void}
 */
function focusRename(el) {
	// the function ref re-fires on each keystroke's re-render; only focus/select
	// on the first call (when the input isn't already focused) so typing past two
	// characters doesn't keep re-selecting and overwriting
	if (el && document.activeElement !== el) {
		el.focus();
		el.select();
	}
}

/**
 * Commits the edited name (if non-empty) and leaves rename mode.
 *
 * @param {Object} source - the source being renamed
 * @returns {void}
 */
function commitRename(source) {
	if (editingId.value !== source.id)
		return;
	const next = editingName.value.trim();
	if (next)
		source.name.value = next;
	editingId.value = null;
	app.requestSave();
}

/**
 * Cancels rename mode without changing the name.
 *
 * @returns {void}
 */
function cancelRename() {
	editingId.value = null;
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
					<input
						v-if="editingId === source.id"
						:ref="focusRename"
						class="name-edit"
						v-model="editingName"
						@click.stop
						@keydown.enter="commitRename(source)"
						@keydown.esc="cancelRename"
						@blur="commitRename(source)"
					/>
					<span v-else class="name" title="Double-click to rename" @dblclick.stop="startRename(source)">{{ source.name.value }}</span>
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

			.name-edit {
				width: 100%;
				font-size: 13px;
				background: #26262c;
				color: #fff;
				border: 1px solid var(--accent-border);
				border-radius: 3px;
				padding: 1px 4px;
				outline: none;
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
