<script lang="ts">
	import { onMount, onDestroy } from 'svelte';

	interface SSRMetrics {
		serverRenderTimeMs: number;
		hydrationTimeMs: number;
		payloadSizeBytes: number;
		mismatchWarnings: string[];
	}

	let metrics = $state<SSRMetrics | null>(null);
	let loading = $state(true);

	const fetchSsr = async () => {
		try {
			const res = await fetch('/__absolute_dev/ssr');
			metrics = await res.json();
		} catch (e) {
			console.error('Failed to load SSR metrics', e);
		} finally {
			loading = false;
		}
	};

	onMount(() => {
		fetchSsr();
	});
</script>

<div class="panel">
	<h2>SSR Metrics</h2>

	{#if loading}
		<div class="loading">Loading SSR performance data...</div>
	{:else if metrics}
		<div class="metrics-grid">
			<div class="metric-card">
				<div class="icon server">
					<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none">
						<rect x="2" y="2" width="20" height="8" rx="2" ry="2"></rect>
						<rect x="2" y="14" width="20" height="8" rx="2" ry="2"></rect>
						<line x1="6" y1="6" x2="6.01" y2="6"></line>
						<line x1="6" y1="18" x2="6.01" y2="18"></line>
					</svg>
				</div>
				<div class="details">
					<h3>Server Render</h3>
					<div class="val">{metrics.serverRenderTimeMs.toFixed(1)}ms</div>
				</div>
			</div>

			<div class="metric-card">
				<div class="icon hydration">
					<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none">
						<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
					</svg>
				</div>
				<div class="details">
					<h3>Hydration</h3>
					<div class="val">{metrics.hydrationTimeMs.toFixed(1)}ms</div>
				</div>
			</div>

			<div class="metric-card">
				<div class="icon payload">
					<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none">
						<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
						<polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline>
						<line x1="12" y1="22.08" x2="12" y2="12"></line>
					</svg>
				</div>
				<div class="details">
					<h3>Payload Size</h3>
					<div class="val">{(metrics.payloadSizeBytes / 1024).toFixed(2)} KB</div>
				</div>
			</div>
		</div>

		{#if metrics.mismatchWarnings.length > 0}
			<div class="mismatches">
				<h3>Hydration Mismatches Found</h3>
				<ul>
					{#each metrics.mismatchWarnings as warning}
						<li>{warning}</li>
					{/each}
				</ul>
			</div>
		{/if}
	{:else}
		<div class="empty">SSR metrics are currently unavailable.</div>
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

	.metrics-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
		gap: 1.5rem;
		margin-bottom: 2rem;
	}

	.metric-card {
		background: #1e222a;
		border: 1px solid #2d3748;
		border-radius: 8px;
		padding: 1.5rem;
		display: flex;
		align-items: center;
		gap: 1.25rem;
	}

	.icon {
		width: 48px;
		height: 48px;
		border-radius: 12px;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.icon svg {
		width: 24px;
		height: 24px;
	}

	.icon.server {
		background: rgba(59, 130, 246, 0.1);
		color: #60a5fa;
	}

	.icon.hydration {
		background: rgba(245, 158, 11, 0.1);
		color: #f59e0b;
	}

	.icon.payload {
		background: rgba(16, 185, 129, 0.1);
		color: #34d399;
	}

	.details h3 {
		margin: 0 0 0.25rem 0;
		font-size: 0.85rem;
		color: #94a3b8;
		text-transform: uppercase;
		letter-spacing: 0.5px;
	}

	.details .val {
		font-size: 1.75rem;
		font-weight: 600;
		color: #e2e8f0;
	}

	.mismatches {
		background: rgba(239, 68, 68, 0.1);
		border: 1px solid rgba(239, 68, 68, 0.2);
		border-radius: 8px;
		padding: 1.5rem;
	}

	.mismatches h3 {
		color: #fca5a5;
		margin: 0 0 1rem 0;
		font-size: 1rem;
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.mismatches ul {
		margin: 0;
		padding-left: 1.5rem;
		color: #fecaca;
		font-family: ui-monospace, monospace;
		font-size: 0.85rem;
	}

	.mismatches li {
		margin-bottom: 0.5rem;
	}

	@keyframes fadeIn {
		from { opacity: 0; transform: translateY(5px); }
		to { opacity: 1; transform: translateY(0); }
	}
</style>
