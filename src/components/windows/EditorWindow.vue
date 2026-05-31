<!--
	EditorWindow.vue
	----------------

	Window that hosts the editor for a wave source. By default it follows the
	app's current selection, so it always shows whatever source is selected.

	It can also be PINNED to a specific source via the pin toggle: while pinned
	it ignores the selection and keeps editing its own source, which lets the
	user open several editor windows and work on several sources at once. If a
	pinned source is removed, the editor automatically unpins and reverts to
	following the selection.

	The real per-type editors (bezier, combiner, etc.) arrive in later phases;
	for now the body is a placeholder that reports which source it is bound to.
-->
<script setup>

// vue
import { inject, computed, ref, watch } from "vue";

// shared app state, plus the per-window context (for the title)
const app = inject("app");
const windowCtx = inject("windowCtx", null);

// pin state is local to this window instance
const pinned = ref(false);
const pinnedId = ref(null);

// which source this editor is currently bound to
const boundId = computed(() => (pinned.value ? pinnedId.value : app.selectedSourceId.value));
const boundSource = computed(() => app.getSource(boundId.value));

/**
 * Toggles the pin. Pinning locks the editor to the source it is currently
 * showing; unpinning returns it to following the selection.
 *
 * @returns {void}
 */
function togglePin() {

	if (pinned.value) {
		pinned.value = false;
		pinnedId.value = null;
		return;
	}

	// only pin if there is actually a source to pin to
	if (boundId.value !== null) {
		pinnedId.value = boundId.value;
		pinned.value = true;
	}
}

// keep the window's tab title in sync with the bound source
watch(boundSource, (source) => {
	if (windowCtx && typeof windowCtx.setTitle === "function")
		windowCtx.setTitle(source ? `Editor — ${source.name}` : "Editor");
}, { immediate: true });

// if a pinned source disappears, unpin and fall back to the selection
watch(() => app.sources.value, (list) => {
	if (pinned.value && !list.some(s => s.id === pinnedId.value)) {
		pinned.value = false;
		pinnedId.value = null;
	}
});

</script>
<template>

	<div class="editor-window">

		<header class="bar">
			<span class="title">{{ boundSource ? boundSource.name : "No source" }}</span>
			<span v-if="boundSource" class="type">{{ boundSource.type }}</span>

			<button
				class="pin"
				type="button"
				:class="{ active: pinned }"
				:disabled="!pinned && boundId === null"
				:title="pinned ? 'Unpin (follow selection)' : 'Pin to this source'"
				@click="togglePin"
			>
				<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
					<path
						fill="currentColor"
						d="M14 4v5l2 3v2h-4v5l-1 1-1-1v-5H6v-2l2-3V4H7V2h8v2h-1z"
					/>
				</svg>
			</button>
		</header>

		<div class="body">
			<template v-if="boundSource">
				<p class="headline">Editor for <strong>{{ boundSource.name }}</strong></p>
				<p class="detail">Type: {{ boundSource.type }}</p>
				<p class="note">
					The {{ boundSource.type }} editor arrives in a later phase.
					<template v-if="pinned">This window is pinned to this source.</template>
					<template v-else>This window follows the current selection.</template>
				</p>
			</template>
			<p v-else class="empty">Select or add a source to edit it.</p>
		</div>

	</div>

</template>
<style lang="scss" scoped>

	.editor-window {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
		background: #0f0f11;
		color: #ddd;
	}

	.bar {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 8px 12px;
		border-bottom: 1px solid #000;
		background: #17171a;
		flex: 0 0 auto;

		.title {
			font-size: 13px;
			font-weight: 600;
		}

		.type {
			font-size: 10px;
			text-transform: uppercase;
			color: #888;
		}

		.pin {
			margin-left: auto;
			width: 28px;
			height: 24px;
			display: flex;
			align-items: center;
			justify-content: center;
			border: 1px solid #444;
			border-radius: 4px;
			background: #26262c;
			color: #999;
			cursor: pointer;

			&:hover:not(:disabled) {
				color: #ddd;
			}

			&.active {
				background: #2f4a5c;
				color: #6cc4ff;
				border-color: #3a6c86;
			}

			&:disabled {
				opacity: 0.4;
				cursor: default;
			}
		}
	}

	.body {
		flex: 1 1 auto;
		overflow: auto;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 6px;
		padding: 16px;
		text-align: center;

		.headline {
			font-size: 15px;
		}

		.detail {
			font-size: 12px;
			color: #aaa;
		}

		.note {
			font-size: 12px;
			color: #777;
			max-width: 320px;
		}

		.empty {
			color: #555;
			font-size: 14px;
		}
	}

</style>
