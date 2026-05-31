<!--
	SourcesWindow.vue
	-----------------

	Window listing the project's wave sources, with controls to add, select and
	remove them. Reads the shared App state, so multiple Sources windows stay in
	sync. Fills its parent frame and scrolls internally.
-->
<script setup>

// vue
import { inject } from "vue";

// shared app state
const app = inject("app");

/**
 * Adds a new placeholder source.
 *
 * @returns {void}
 */
function addSource() {
	app.addSource("generated");
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
 * Removes a source without letting the click also select it.
 *
 * @param {String} id - source id
 * @param {Event} event - the click event
 * @returns {void}
 */
function remove(id, event) {
	event.stopPropagation();
	app.removeSource(id);
}

</script>
<template>

	<div class="sources-window">
		<header class="header">
			<h2>Sources</h2>
			<button class="add" type="button" title="Add source" @click="addSource">+</button>
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
				<span class="thumb">{{ source.type.charAt(0).toUpperCase() }}</span>
				<span class="name">{{ source.name }}</span>
				<span class="type">{{ source.type }}</span>
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
			background: #2f4a5c;
		}

		.thumb {
			flex: 0 0 auto;
			width: 26px;
			height: 26px;
			display: flex;
			align-items: center;
			justify-content: center;
			background: #111;
			border: 1px solid #3a3a42;
			border-radius: 4px;
			font-size: 12px;
			color: #6cc4ff;
		}

		.name {
			flex: 1 1 auto;
			font-size: 13px;
			white-space: nowrap;
			overflow: hidden;
			text-overflow: ellipsis;
		}

		.type {
			flex: 0 0 auto;
			font-size: 10px;
			color: #888;
			text-transform: uppercase;
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

</style>
