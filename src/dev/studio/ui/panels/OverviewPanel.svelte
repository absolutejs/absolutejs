<!--
 Absolute Studio Overview Panel
 System-Level Runtime Intelligence
-->
<script lang="ts">
	import { onMount, onDestroy } from 'svelte';

	interface OverviewState {
		runtime?: {
			noRoute?: boolean;
			route?: string;
			accessCount?: number;
			pageFramework: string;
			ssrEnabled: boolean;
			hmrStrategy: string;
			zoneless?: boolean;
			hydrationMode?: string;
			devMode: boolean;
		};

		routes?: {
			total: number;
			api: number;
			pages: number;
		};

		hmr?: {
			lastEvent?: {
				framework: string;
				updateType: string;
				durationMs: number;
				fallback: boolean;
				reason?: string;
			};
			averageLast5?: number;
			fallbackCountLast10?: number;
		};

		state?: {
			totalUnits: number;
			byFramework: Record<string, number>;
		};

		ssr?: {
			serverRenderTimeMs?: number;
			hydrationTimeMs?: number;
			payloadSizeBytes?: number;
			mismatchWarnings?: string[];
		};

		health: {
			hmrStable: boolean;
			hydrationClean: boolean;
			routeShapeIssues: boolean;
			staleRoutesDetected: boolean;
		};
	}

	let overview = $state<OverviewState>({
		health: {
			hmrStable: true,
			hydrationClean: true,
			routeShapeIssues: false,
			staleRoutesDetected: false
		}
	});

	let loading = $state(true);
	let systemOffline = $state(false);
	let pollingTimer: number | NodeJS.Timeout;

	const fetchAll = async () => {
		try {
			const [runtimeRes, routesRes, hmrRes, stateRes, ssrRes] = await Promise.allSettled([
				fetch('/__absolute_dev/runtime'),
				fetch('/__absolute_dev/routes'),
				fetch('/__absolute_dev/hmr'),
				fetch('/__absolute_dev/state'),
				fetch('/__absolute_dev/ssr')
			]);

			// If completely offline (e.g. server down)
			if (
				runtimeRes.status === 'rejected' &&
				routesRes.status === 'rejected' &&
				hmrRes.status === 'rejected' &&
				stateRes.status === 'rejected' &&
				ssrRes.status === 'rejected'
			) {
				systemOffline = true;
				return;
			}
			systemOffline = false;

			let newState: Partial<OverviewState> = {};
			const health = {
				hmrStable: true,
				hydrationClean: true,
				routeShapeIssues: false,
				staleRoutesDetected: false
			};

			// Process Runtime
			if (runtimeRes.status === 'fulfilled' && runtimeRes.value.ok) {
				const r = await runtimeRes.value.json();
				if (r.status === 'no-active-route') {
					// No application route loaded yet
					newState.runtime = { noRoute: true } as any;
				} else {
					// Map "framework" from tracking backend to "pageFramework" expected by UI
					newState.runtime = { ...r, pageFramework: r.framework };
				}
			}

			// Process Routes
			if (routesRes.status === 'fulfilled' && routesRes.value.ok) {
				const r = await routesRes.value.json();
				const now = Date.now();
				newState.routes = {
					total: r.length,
					api: r.filter((x: any) => x.type === 'api').length,
					pages: r.filter((x: any) => x.type === 'page').length
				};

				// Simple heuristic for stale routes (> 2 years old)
				const twoYearsMs = 1000 * 60 * 60 * 24 * 365 * 2;
				if (r.some((x: any) => x.lastModified && (now - x.lastModified > twoYearsMs))) {
					health.staleRoutesDetected = true;
				}

				// Check shape issues (any with error flags if we added them, though currently inferred)
			}

			// Process HMR
			if (hmrRes.status === 'fulfilled' && hmrRes.value.ok) {
				const h = (await hmrRes.value.json()) as any[];
				newState.hmr = {};
				if (h && h.length > 0) {
					// Ring buffer, assuming last item is most recent
					const last = h[h.length - 1];
					newState.hmr.lastEvent = last;

					const last5 = h.slice(-5);
					const validDurations = last5.filter(x => typeof x.durationMs === 'number');
					if (validDurations.length > 0) {
						newState.hmr.averageLast5 = validDurations.reduce((acc, curr) => acc + curr.durationMs, 0) / validDurations.length;
					}

					const last10 = h.slice(-10);
					const fallbacks = last10.filter(x => x.fallback);
					newState.hmr.fallbackCountLast10 = fallbacks.length;

					if (fallbacks.length > 0) {
						health.hmrStable = false;
					}
				}
			}

			// Process State
			if (stateRes.status === 'fulfilled' && stateRes.value.ok) {
				const s = (await stateRes.value.json()) as any[];
				
				// Keep stale state briefly during HMR reconnects to stop flickering
				if (s.length === 0 && overview.state && overview.state.totalUnits > 0) {
					newState.state = overview.state;
				} else {
					const byFramework: Record<string, number> = {};
					for (const unit of s) {
						const fw = unit.framework || 'unknown';
						byFramework[fw] = (byFramework[fw] || 0) + 1;
					}
					newState.state = {
						totalUnits: s.length,
						byFramework
					};
				}
			}

			// Process SSR
			if (ssrRes.status === 'fulfilled' && ssrRes.value.ok) {
				const s = await ssrRes.value.json();
				
				// During JIT dev reloading, hydration takes a frame to report.
				// Keep the last valid metrics visible instead of snapping to 0.
				if (s.serverRenderTimeMs === 0 && s.hydrationTimeMs === 0 && overview.ssr && overview.ssr.serverRenderTimeMs! > 0) {
					newState.ssr = overview.ssr;
				} else {
					newState.ssr = s;
				}

				if (s.mismatchWarnings && s.mismatchWarnings.length > 0) {
					health.hydrationClean = false;
				}
			}

			newState.health = health;
			overview = newState as OverviewState;
		} catch (e) {
			console.warn('Failed to poll introspection data', e);
		} finally {
			loading = false;
		}
	};

	onMount(() => {
		fetchAll();
		pollingTimer = setInterval(fetchAll, 2000);
	});

	onDestroy(() => {
		if (pollingTimer) clearInterval(pollingTimer);
	});

	const getFrameworkColor = (fw?: string) => {
		if (!fw) return '#6b7280';
		const lower = fw.toLowerCase();
		if (lower.includes('angular')) return '#ef4444'; // Red
		if (lower.includes('svelte')) return '#f97316'; // Orange
		if (lower.includes('react')) return '#3b82f6'; // Blue
		if (lower.includes('vue')) return '#22c55e'; // Green
		if (lower.includes('html')) return '#6b7280'; // Gray
		return '#6b7280';
	};
</script>

<div class="panel">
	<h2>Mission Control Overview</h2>

	{#if systemOffline}
		<div class="offline-banner">
			<h3>Absolute Dev Introspection Offline</h3>
			<p>Make sure the development server is actively running.</p>
		</div>
	{:else if loading && !overview.runtime}
		<div class="loading">Booting metrics...</div>
	{:else if overview.runtime?.noRoute}
		<div class="offline-banner" style="background: #3b82f620; border-color: #3b82f650;">
			<h3 style="color: #60a5fa;">No application route loaded yet.</h3>
			<p>Open an app route in another tab to begin active introspection.</p>
		</div>
	{:else}
		<div class="dashboard-grid">
			<!-- Section A: Runtime Identity -->
			<section class="card section-runtime">
				<h3>Runtime Identity</h3>
				<div class="runtime-info">
					<div class="detail-row">
						<span>Framework</span>
						<div class="badge" style="background: {getFrameworkColor(overview.runtime?.pageFramework)}20; color: {getFrameworkColor(overview.runtime?.pageFramework)};">
							{overview.runtime?.pageFramework?.toUpperCase() || 'UNKNOWN'}
						</div>
					</div>
					<div class="detail-row">
						<span>Active Route</span>
						<span class="value" style="font-family: monospace; font-size: 0.9em; color: #94a3b8;">
							{overview.runtime?.route || '—'}
						</span>
					</div>
					{#if overview.runtime?.accessCount}
						<div class="detail-row">
							<span>Access Count</span>
							<span class="value" style="font-size: 0.95em;">
								Accessed {overview.runtime.accessCount} {overview.runtime.accessCount === 1 ? 'time' : 'times'} this session
							</span>
						</div>
					{/if}
					<div class="detail-row">
						<span>SSR Enabled</span>
						<span class="value">{overview.runtime?.ssrEnabled ? 'Active' : 'Disabled'}</span>
					</div>
					<div class="detail-row">
						<span>HMR Strategy</span>
						<span class="value">{overview.runtime?.hmrStrategy || '—'}</span>
					</div>
					{#if overview.runtime?.hydrationMode}
						<div class="detail-row">
							<span>Hydration Mode</span>
							<span class="value">{overview.runtime.hydrationMode}</span>
						</div>
					{/if}
					{#if overview.runtime?.zoneless !== undefined}
						<div class="detail-row">
							<span>Zoneless Status</span>
							<span class="value">{overview.runtime.zoneless ? 'Enabled' : 'Disabled'}</span>
						</div>
					{/if}
					{#if overview.runtime?.devMode}
						<div class="detail-row">
							<span>Environment</span>
							<div class="badge dev-badge">DEV MODE</div>
						</div>
					{/if}
				</div>
			</section>

			<!-- Section B: System Health -->
			<section class="card section-health">
				<h3>System Health</h3>
				<div class="health-chips">
					<div class="chip" class:warning={!overview.health.hmrStable}>
						<span class="icon">{overview.health.hmrStable ? '✔' : '⚠'}</span>
						{overview.health.hmrStable ? 'No HMR fallbacks' : 'HMR fallbacks detected'}
					</div>
					<div class="chip" class:warning={!overview.health.hydrationClean}>
						<span class="icon">{overview.health.hydrationClean ? '✔' : '⚠'}</span>
						{overview.health.hydrationClean ? 'No hydration mismatches' : 'Hydration mismatches detected'}
					</div>
					<div class="chip" class:warning={overview.health.routeShapeIssues}>
						<span class="icon">{!overview.health.routeShapeIssues ? '✔' : '⚠'}</span>
						{!overview.health.routeShapeIssues ? 'Route integrity stable' : 'Route shape mismatch detected'}
					</div>
					<div class="chip" class:warning={overview.health.staleRoutesDetected}>
						<span class="icon">{!overview.health.staleRoutesDetected ? '✔' : '⚠'}</span>
						{!overview.health.staleRoutesDetected ? 'No stale routes' : 'Unused routes in session'}
					</div>
				</div>
			</section>

			<!-- Section C: Live Metrics -->
			<section class="card section-metrics">
				<h3>Live Metrics</h3>
				<div class="metrics-grid">
					<div class="metric-box">
						<span class="metric-label">Server Render</span>
						<span class="metric-value">
							{overview.ssr?.serverRenderTimeMs !== undefined ? `${overview.ssr.serverRenderTimeMs.toFixed(1)} ms` : '—'}
						</span>
					</div>
					<div class="metric-box">
						<span class="metric-label">Client Hydration</span>
						<span class="metric-value">
							{overview.ssr?.hydrationTimeMs !== undefined ? `${overview.ssr.hydrationTimeMs.toFixed(1)} ms` : '—'}
						</span>
					</div>
					<div class="metric-box">
						<span class="metric-label">HMR Avg (Last 5)</span>
						<span class="metric-value">
							{overview.hmr?.averageLast5 !== undefined ? `${overview.hmr.averageLast5.toFixed(1)} ms` : '—'}
						</span>
					</div>
					<div class="metric-box">
						<span class="metric-label">Active State Units</span>
						<span class="metric-value">
							{overview.state?.totalUnits !== undefined ? overview.state.totalUnits : '—'}
						</span>
					</div>
				</div>
			</section>

			<!-- Section D: Last HMR Snapshot -->
			<section class="card section-hmr-snapshot">
				<h3>Last HMR Snapshot</h3>
				{#if overview.hmr?.lastEvent}
					<div class="snapshot" class:fallback={overview.hmr.lastEvent.fallback}>
						<div class="snap-row">
							<span class="snap-label">Framework</span>
							<span class="snap-value">{overview.hmr.lastEvent.framework}</span>
						</div>
						<div class="snap-row">
							<span class="snap-label">Type</span>
							<span class="snap-value">{overview.hmr.lastEvent.updateType}</span>
						</div>
						<div class="snap-row">
							<span class="snap-label">Duration</span>
							<span class="snap-value">{overview.hmr.lastEvent.durationMs.toFixed(1)} ms</span>
						</div>
						<div class="snap-row">
							<span class="snap-label">Fallback</span>
							<span class="snap-value" class:text-warning={overview.hmr.lastEvent.fallback}>
								{overview.hmr.lastEvent.fallback ? 'Yes' : 'No'}
							</span>
						</div>
						{#if overview.hmr.lastEvent.reason}
							<div class="snap-row">
								<span class="snap-label">Reason</span>
								<span class="snap-value text-muted">{overview.hmr.lastEvent.reason}</span>
							</div>
						{/if}
						<div class="timestamp">Just now (Auto-updated)</div>
					</div>
				{:else}
					<div class="empty-state">No HMR events recorded yet.</div>
				{/if}
			</section>
		</div>
	{/if}
</div>

<style>
	.panel {
		animation: fadeIn 0.3s ease;
		max-width: 1200px;
		margin: 0 auto;
	}

	h2 {
		margin-top: 0;
		margin-bottom: 2rem;
		font-weight: 500;
		color: #f8fafc;
	}

	.offline-banner {
		background: #ef444420;
		border: 1px solid #ef444450;
		padding: 3rem 2rem;
		border-radius: 12px;
		text-align: center;
		color: #f8fafc;
	}

	.offline-banner h3 {
		color: #ef4444;
		margin-top: 0;
		font-size: 1.5rem;
	}

	.loading {
		color: #94a3b8;
		font-style: italic;
	}

	.dashboard-grid {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: 1.5rem;
	}

	@media (max-width: 900px) {
		.dashboard-grid {
			grid-template-columns: 1fr;
		}
	}

	.card {
		background: #1e222a;
		border: 1px solid #2d3748;
		border-radius: 8px;
		padding: 1.5rem;
		box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
	}

	.card h3 {
		margin: 0 0 1.25rem 0;
		font-size: 0.85rem;
		color: #94a3b8;
		text-transform: uppercase;
		letter-spacing: 0.5px;
		border-bottom: 1px solid #2d3748;
		padding-bottom: 0.5rem;
	}

	/* Section A: Runtime */
	.detail-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 0.5rem 0;
		border-bottom: 1px dashed #2d3748;
	}
	.detail-row:last-child {
		border-bottom: none;
	}
	.detail-row span:first-child {
		color: #94a3b8;
		font-size: 0.95rem;
	}
	.detail-row .value {
		color: #e2e8f0;
		font-weight: 500;
	}

	.badge {
		font-size: 0.7rem;
		font-weight: 700;
		padding: 0.2rem 0.6rem;
		border-radius: 4px;
		letter-spacing: 0.5px;
	}
	.dev-badge {
		background: #6366f120;
		color: #818cf8;
	}

	/* Section B: Health */
	.health-chips {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	.chip {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.75rem 1rem;
		border-radius: 6px;
		background: #22c55e15;
		color: #4ade80;
		border: 1px solid #22c55e30;
		font-size: 0.95rem;
	}
	.chip.warning {
		background: #eab30815;
		color: #facc15;
		border-color: #eab30830;
	}
	.icon {
		font-size: 1.1rem;
	}

	/* Section C: Live Metrics */
	.metrics-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 1rem;
	}
	.metric-box {
		background: #15181e;
		padding: 1rem;
		border-radius: 6px;
		border: 1px solid #2d3748;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.metric-label {
		color: #94a3b8;
		font-size: 0.8rem;
		text-transform: uppercase;
		letter-spacing: 0.5px;
	}
	.metric-value {
		font-size: 1.5rem;
		font-weight: 600;
		color: #60a5fa;
	}

	/* Section D: Snapshot */
	.snapshot {
		background: #15181e;
		border-radius: 6px;
		border: 1px solid #2d3748;
		padding: 1rem;
	}
	.snapshot.fallback {
		background: #ef444410;
		border-color: #ef444430;
	}
	.snap-row {
		display: flex;
		justify-content: space-between;
		padding: 0.4rem 0;
	}
	.snap-label {
		color: #94a3b8;
		font-size: 0.9rem;
	}
	.snap-value {
		color: #e2e8f0;
		font-weight: 500;
	}
	.text-warning {
		color: #facc15;
	}
	.text-muted {
		color: #64748b;
		font-size: 0.85rem;
	}
	.timestamp {
		margin-top: 1rem;
		font-size: 0.75rem;
		color: #64748b;
		text-align: right;
	}
	.empty-state {
		color: #64748b;
		font-style: italic;
		text-align: center;
		padding: 2rem 0;
	}

	@keyframes fadeIn {
		from { opacity: 0; transform: translateY(5px); }
		to { opacity: 1; transform: translateY(0); }
	}
</style>
