<script lang="ts">
	import { onMount } from 'svelte';

	interface Route {
		path: string;
		method: string;
		type: 'api' | 'page';
		handlerFile: string;
		framework: string | null;
		lastModified: number;
		runtimeSampleShape: any | null;
	}

	let routes = $state<Route[]>([]);
	let loading = $state(true);

	// Expanded state tracking for the JSON viewer
	let expandedRoutes = $state<Set<string>>(new Set());

	onMount(async () => {
		try {
			const res = await fetch('/__absolute_dev/routes');
			const parsed = await res.json();
			// Sort so Pages are first, APIs second
			routes = parsed.sort((a: Route, b: Route) => {
				if (a.type !== b.type) {
					return a.type === 'page' ? -1 : 1;
				}
				return a.path.localeCompare(b.path);
			});
		} catch (e) {
			console.error('Failed to load routes', e);
		} finally {
			loading = false;
		}
	});

	const toggleExpand = (path: string) => {
		const newExpanded = new Set(expandedRoutes);
		if (newExpanded.has(path)) {
			newExpanded.delete(path);
		} else {
			newExpanded.add(path);
		}
		expandedRoutes = newExpanded;
	};
</script>

<div class="panel">
	<h2>Routes Directory</h2>

	{#if loading}
		<div class="loading">Scanning active routes...</div>
	{:else}
		<div class="route-list">
			{#each routes as route}
				<div class="route-card" class:api={route.type === 'api'} class:page={route.type === 'page'}>
					<div class="route-header">
						<div class="route-info">
							<span class="method {route.method.toLowerCase()}">{route.method}</span>
							<span class="path">{route.path}</span>
							<span class="badge {route.type}">{route.type.toUpperCase()}</span>
						</div>
						
						{#if route.type === 'api' && route.runtimeSampleShape}
							<button class="expand-btn" onclick={() => toggleExpand(route.path)}>
								{expandedRoutes.has(route.path) ? 'Hide Sample' : 'View Sample'}
							</button>
						{/if}
					</div>

					{#if expandedRoutes.has(route.path)}
						<div class="sample-viewer">
							<!-- Hacky simple JSON stringifier that formats nicely -->
							<pre>{JSON.stringify(route.runtimeSampleShape, null, 2)}</pre>
						</div>
					{/if}
				</div>
			{/each}
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
	}

	.route-list {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.route-card {
		background: #1e222a;
		border: 1px solid #2d3748;
		border-radius: 8px;
		overflow: hidden;
		transition: border-color 0.2s;
	}

	.route-card:hover {
		border-color: #4b5563;
	}

	.route-card.api {
		border-left: 3px solid #f59e0b;
	}

	.route-card.page {
		border-left: 3px solid #3b82f6;
	}

	.route-header {
		padding: 1rem 1.25rem;
		display: flex;
		justify-content: space-between;
		align-items: center;
	}

	.route-info {
		display: flex;
		align-items: center;
		gap: 1rem;
	}

	.method {
		font-size: 0.75rem;
		font-weight: 700;
		padding: 0.2rem 0.6rem;
		border-radius: 4px;
		background: rgba(255, 255, 255, 0.1);
	}

	.method.get { color: #60a5fa; background: rgba(96, 165, 250, 0.1); }
	.method.post { color: #4ade80; background: rgba(74, 222, 128, 0.1); }
	.method.put { color: #f59e0b; background: rgba(245, 158, 11, 0.1); }
	.method.delete { color: #f87171; background: rgba(248, 113, 113, 0.1); }

	.path {
		font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
		font-size: 0.95rem;
		color: #e2e8f0;
	}

	.badge {
		font-size: 0.65rem;
		font-weight: 700;
		padding: 0.15rem 0.4rem;
		border-radius: 4px;
		letter-spacing: 0.5px;
	}

	.badge.page { background: rgba(59, 130, 246, 0.15); color: #60a5fa; }
	.badge.api { background: rgba(245, 158, 11, 0.15); color: #f59e0b; }

	.expand-btn {
		background: #2d3748;
		border: none;
		color: #e2e8f0;
		padding: 0.4rem 0.8rem;
		border-radius: 4px;
		font-size: 0.8rem;
		cursor: pointer;
		transition: background 0.2s;
	}

	.expand-btn:hover {
		background: #4b5563;
	}

	.sample-viewer {
		padding: 1rem;
		background: #0f1115;
		border-top: 1px solid #2d3748;
	}

	pre {
		margin: 0;
		font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
		font-size: 0.85rem;
		color: #a78bfa;
		white-space: pre-wrap;
		word-break: break-all;
	}

	.loading {
		color: #94a3b8;
	}

	@keyframes fadeIn {
		from { opacity: 0; transform: translateY(5px); }
		to { opacity: 1; transform: translateY(0); }
	}
</style>
