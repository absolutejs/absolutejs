<script lang="ts">
	import OverviewPanel from './panels/OverviewPanel.svelte';
	import RoutesPanel from './panels/RoutesPanel.svelte';
	import StatePanel from './panels/StatePanel.svelte';
	import HmrPanel from './panels/HmrPanel.svelte';
	import SsrPanel from './panels/SsrPanel.svelte';

	let activePanel = $state('overview');
	const panels = [
		{ id: 'overview', label: 'Overview' },
		{ id: 'routes', label: 'Routes' },
		{ id: 'state', label: 'State' },
		{ id: 'hmr', label: 'HMR Log' },
		{ id: 'ssr', label: 'SSR Metrics' }
	];
</script>

<div class="layout">
	<aside class="sidebar">
		<div class="brand">
			<h1>Absolute Studio</h1>
			<div class="badge">DEV</div>
		</div>
		<nav>
			{#each panels as panel}
				<button
					class="nav-item"
					class:active={activePanel === panel.id}
					onclick={() => (activePanel = panel.id)}
				>
					{panel.label}
				</button>
			{/each}
		</nav>
	</aside>

	<main class="content">
		{#if activePanel === 'overview'}
			<OverviewPanel />
		{:else if activePanel === 'routes'}
			<RoutesPanel />
		{:else if activePanel === 'state'}
			<StatePanel />
		{:else if activePanel === 'hmr'}
			<HmrPanel />
		{:else if activePanel === 'ssr'}
			<SsrPanel />
		{/if}
	</main>
</div>

<style>
	:global(html, body) {
		margin: 0;
		padding: 0;
		font-family:
			system-ui,
			-apple-system,
			BlinkMacSystemFont,
			'Segoe UI',
			Roboto,
			Oxygen,
			Ubuntu,
			Cantarell,
			'Open Sans',
			'Helvetica Neue',
			sans-serif;
		background: #0f1115; /* Dark modern theme */
		color: #e2e8f0;
	}

	.layout {
		display: flex;
		height: 100vh;
		overflow: hidden;
	}

	.sidebar {
		width: 250px;
		background: #1a1d24;
		border-right: 1px solid #2d3748;
		display: flex;
		flex-direction: column;
	}

	.brand {
		padding: 1.5rem;
		border-bottom: 1px solid #2d3748;
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.brand h1 {
		font-size: 1.25rem;
		font-weight: 600;
		margin: 0;
		background: linear-gradient(135deg, #4ade80, #3b82f6);
		-webkit-background-clip: text;
		color: transparent;
	}

	.badge {
		background: #4ade8020;
		color: #4ade80;
		font-size: 0.65rem;
		font-weight: 700;
		padding: 0.15rem 0.4rem;
		border-radius: 4px;
		letter-spacing: 1px;
	}

	nav {
		padding: 1rem 0;
		flex: 1;
	}

	.nav-item {
		display: block;
		width: 100%;
		text-align: left;
		padding: 0.75rem 1.5rem;
		background: transparent;
		border: none;
		color: #94a3b8;
		font-size: 0.95rem;
		cursor: pointer;
		transition: all 0.2s ease;
	}

	.nav-item:hover {
		background: #2d3748;
		color: #f8fafc;
	}

	.nav-item.active {
		background: #2d3748;
		color: #f8fafc;
		border-right: 3px solid #3b82f6;
	}

	.content {
		flex: 1;
		padding: 2rem;
		overflow-y: auto;
		background: #0f1115;
	}
</style>
