<!--
	SourceList.vue
	--------------

	Left column listing the project's wave sources. Phase 1 is a placeholder
	shell with the add control; the real source items, thumbnails and type
	picker arrive with the data model in Phase 2.
-->
<script setup>

// (no logic yet — placeholder shell)

</script>
<template>

	<aside class="source-list">
		<header class="header">
			<h2>Sources</h2>
			<button class="add" type="button" disabled title="Coming in Phase 2">+</button>
		</header>

		<p class="empty">No sources yet.</p>
	</aside>

</template>
<style lang="scss" scoped>

	.source-list {
		display: flex;
		flex-direction: column;
		height: 100%;
		background: #1e1e22;
		color: #ddd;
		border-right: 1px solid #000;
	}

	.header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 10px 12px;
		border-bottom: 1px solid #2c2c32;

		h2 {
			margin: 0;
			font-size: 13px;
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
			cursor: not-allowed;
			font-size: 16px;
			line-height: 1;
		}
	}

	.empty {
		margin: 0;
		padding: 14px 12px;
		font-size: 12px;
		color: #777;
	}

</style>
