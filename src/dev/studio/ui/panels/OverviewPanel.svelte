<script lang="ts">
	import { onMount } from 'svelte';

	let runtime = $state<{
		pageFramework: string;
		ssrEnabled: boolean;
		hmrStrategy: string;
		devMode: boolean;
	} | null>(null);

	let routeCount = $state<number>(0);
	let stateCount = $state<number>(0);
	let loading = $state(true);

	onMount(async () => {
		try {
			const [runtimeRes, routesRes, stateRes] = await Promise.all([
				fetch('/__absolute_dev/runtime'),
				fetch('/__absolute_dev/routes'),
				fetch('/__absolute_dev/state')
			]);

			runtime = await runtimeRes.json();
			const routes = await routesRes.json();
			const states = await stateRes.json();

			routeCount = routes.length;
			stateCount = states.length;
		} catch (e) {
			console.error('Failed to load overview data', e);
		} finally {
			loading = false;
		}
	});
</script>

<div class="panel">
	<h2>Overview</h2>

	{#if loading}
		<div class="loading">Loading introspection data...</div>
	{:else if runtime}
		<div class="grid">
			<div class="card">
				<h3>Page Framework</h3>
				<div class="value">{runtime.pageFramework}</div>
			</div>
			<div class="card">
				<h3>HMR Strategy</h3>
				<div class="value">{runtime.hmrStrategy}</div>
			</div>
			<div class="card">
				<h3>SSR Enabled</h3>
				<div class="value" class:positive={runtime.ssrEnabled}>
					{runtime.ssrEnabled ? 'Yes' : 'No'}
				</div>
			</div>
			<div class="card">
				<h3>Total Routes</h3>
				<div class="value metric">{routeCount}</div>
			</div>
			<div class="card">
				<h3>State Units</h3>
				<div class="value metric">{stateCount}</div>
			</div>
		</div>
	{/if}
</div>

<style>
	.panel {
		animation: fadeIn 0.3s ease;
	}

	h2 {
		margin-top: 0;
		margin-bottom: 2rem;
		font-weight: 500;
		color: #f8fafc;
	}

	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
		gap: 1.5rem;
	}

	.card {
		background: #1e222a;
		border: 1px solid #2d3748;
		border-radius: 8px;
		padding: 1.25rem;
		transition: transform 0.2s ease, box-shadow 0.2s ease;
	}

	.card:hover {
		transform: translateY(-2px);
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
		border-color: #4b5563;
	}

	.card h3 {
		margin: 0 0 0.5rem 0;
		font-size: 0.85rem;
		color: #94a3b8;
		text-transform: uppercase;
		letter-spacing: 0.5px;
	}

	.value {
		font-size: 1.5rem;
		font-weight: 600;
		color: #e2e8f0;
	}

	.value.metric {
		color: #60a5fa;
	}

	.value.positive {
		color: #4ade80;
	}

	.loading {
		color: #94a3b8;
		font-style: italic;
	}

	@keyframes fadeIn {
		from { opacity: 0; transform: translateY(5px); }
		to { opacity: 1; transform: translateY(0); }
	}
</style>
