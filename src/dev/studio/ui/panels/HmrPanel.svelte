<script lang="ts">
	import { onMount, onDestroy } from 'svelte';

	interface HMREvent {
		timestamp: number;
		framework: string;
		updateType: string;
		durationMs: number;
		fallback: boolean;
		reason?: string;
	}

	let events = $state<HMREvent[]>([]);
	let loading = $state(true);
	let interval: ReturnType<typeof setInterval>;

	const fetchHmr = async () => {
		try {
			const res = await fetch('/__absolute_dev/hmr');
			events = await res.json();
		} catch (e) {
			console.error('Failed to load HMR data', e);
		} finally {
			loading = false;
		}
	};

	onMount(() => {
		fetchHmr();
		// Auto-refresh every 1s
		interval = setInterval(fetchHmr, 1000);
	});

	onDestroy(() => {
		if (interval) clearInterval(interval);
	});

	const formatTime = (ts: number) => {
		return new Date(ts).toLocaleTimeString(undefined, {
			hour12: false,
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit',
			fractionalSecondDigits: 3
		});
	};
</script>

<div class="panel">
	<h2>HMR Log</h2>

	{#if loading}
		<div class="loading">Loading HMR events...</div>
	{:else if events.length === 0}
		<div class="empty">No hot reloads triggered yet.</div>
	{:else}
		<div class="table-container">
			<table>
				<thead>
					<tr>
						<th>Time</th>
						<th>Framework</th>
						<th>Update Type</th>
						<th>Duration</th>
						<th>Fallback</th>
						<th>Reason</th>
					</tr>
				</thead>
				<tbody>
					{#each events as event}
						<tr class:fallback={event.fallback}>
							<td class="time">{formatTime(event.timestamp)}</td>
							<td>
								<span class="badge {event.framework.toLowerCase()}">
									{event.framework}
								</span>
							</td>
							<td>{event.updateType}</td>
							<td class="duration">{event.durationMs.toFixed(1)}ms</td>
							<td>
								{#if event.fallback}
									<span class="badge warning">Yes</span>
								{:else}
									<span class="badge success">No</span>
								{/if}
							</td>
							<td class="reason">{event.reason || '-'}</td>
						</tr>
					{/each}
				</tbody>
			</table>
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

	.table-container {
		background: #1e222a;
		border: 1px solid #2d3748;
		border-radius: 8px;
		overflow: hidden;
	}

	table {
		width: 100%;
		border-collapse: collapse;
		text-align: left;
	}

	th, td {
		padding: 1rem;
		border-bottom: 1px solid #2d3748;
	}

	th {
		background: #252a33;
		color: #94a3b8;
		font-weight: 500;
		font-size: 0.85rem;
		text-transform: uppercase;
		letter-spacing: 0.5px;
	}

	tr:last-child td {
		border-bottom: none;
	}

	tr:hover td {
		background: #252a33;
	}

	tr.fallback td {
		background: rgba(234, 179, 8, 0.05);
	}

	tr.fallback:hover td {
		background: rgba(234, 179, 8, 0.1);
	}

	.time {
		font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
		color: #94a3b8;
		font-size: 0.9rem;
	}

	.duration {
		font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
		color: #60a5fa;
	}

	.badge {
		display: inline-block;
		padding: 0.2rem 0.5rem;
		border-radius: 4px;
		font-size: 0.75rem;
		font-weight: 600;
		text-transform: uppercase;
	}

	.badge.react { background: rgba(97, 218, 251, 0.15); color: #61dafb; }
	.badge.svelte { background: rgba(255, 62, 0, 0.15); color: #ff3e00; }
	.badge.vue { background: rgba(65, 184, 131, 0.15); color: #41b883; }

	.badge.warning { background: rgba(234, 179, 8, 0.15); color: #eab308; }
	.badge.success { background: rgba(74, 222, 128, 0.15); color: #4ade80; }

	.reason {
		color: #cbd5e1;
		font-size: 0.9rem;
	}

	.empty {
		padding: 3rem;
		text-align: center;
		color: #94a3b8;
		background: #1e222a;
		border-radius: 8px;
		border: 1px dashed #4b5563;
	}

	@keyframes fadeIn {
		from { opacity: 0; transform: translateY(5px); }
		to { opacity: 1; transform: translateY(0); }
	}
</style>
