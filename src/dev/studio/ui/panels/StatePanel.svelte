<script lang="ts">
	import { onMount } from 'svelte';

	interface StateUnit {
		id: string;
		framework: string;
		type: string;
		currentValue: any;
		subscribers: number;
	}

	let states = $state<StateUnit[]>([]);
	let loading = $state(true);
	let editMode = $state<string | null>(null);
	let editValue = $state<string>('');
	let saving = $state(false);

	const fetchState = async () => {
		try {
			const res = await fetch('/__absolute_dev/state');
			states = await res.json();
		} catch (e) {
			console.error('Failed to load state registry', e);
		} finally {
			loading = false;
		}
	};

	onMount(() => {
		fetchState();
		// Polling would be nice here, but maybe expensive for state
	});

	const startEdit = (unit: StateUnit) => {
		editMode = unit.id;
		editValue = typeof unit.currentValue === 'object' 
			? JSON.stringify(unit.currentValue, null, 2)
			: String(unit.currentValue);
	};

	const cancelEdit = () => {
		editMode = null;
		editValue = '';
	};

	const saveEdit = async (unit: StateUnit) => {
		saving = true;
		try {
			let parsedValue;
			// Try to parse as JSON if it was an object, otherwise infer type
			if (typeof unit.currentValue === 'object') {
				parsedValue = JSON.parse(editValue);
			} else if (typeof unit.currentValue === 'number') {
				parsedValue = Number(editValue);
			} else if (typeof unit.currentValue === 'boolean') {
				parsedValue = editValue === 'true';
			} else {
				parsedValue = editValue;
			}

			await fetch('/__absolute_dev/state/update', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					id: unit.id,
					newValue: parsedValue
				})
			});

			await fetchState();
			cancelEdit();
		} catch (e) {
			alert('Failed to save state. Invalid format?');
		} finally {
			saving = false;
		}
	};
</script>

<div class="panel">
	<div class="header-row">
		<h2>State Registry</h2>
		<button class="refresh-btn" onclick={fetchState}>Refresh</button>
	</div>

	{#if loading}
		<div class="loading">Loading state registry...</div>
	{:else if states.length === 0}
		<div class="empty">
			No dev-registered state units found.<br>
			<small>Framework adapters map reactive units to window.__ABS_STATE_REGISTRY__.</small>
		</div>
	{:else}
		<div class="state-grid">
			{#each states as unit}
				<div class="state-card">
					<div class="card-header">
						<div class="title-row">
							<span class="id">{unit.id}</span>
							<span class="badge {unit.framework.toLowerCase()}">{unit.framework}</span>
						</div>
						<div class="meta-row">
							<span class="type-badge">{unit.type}</span>
							<span class="subs" title="Subscribers">
								<svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" stroke-width="2" fill="none">
									<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
									<circle cx="9" cy="7" r="4"></circle>
									<path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
									<path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
								</svg>
								{unit.subscribers}
							</span>
						</div>
					</div>

					<div class="card-body">
						{#if editMode === unit.id}
							<textarea 
								class="editor" 
								bind:value={editValue}
								rows={typeof unit.currentValue === 'object' ? 5 : 2}
							></textarea>
							<div class="editor-actions">
								<button class="btn secondary" onclick={cancelEdit} disabled={saving}>Cancel</button>
								<button class="btn primary" onclick={() => saveEdit(unit)} disabled={saving}>
									{saving ? 'Saving...' : 'Save'}
								</button>
							</div>
						{:else}
							<pre class="value-viewer">{JSON.stringify(unit.currentValue, null, 2)}</pre>
							<button class="edit-btn" onclick={() => startEdit(unit)}>
								Edit State
							</button>
						{/if}
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>

<style>
	.panel {
		animation: fadeIn 0.3s ease;
	}

	.header-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 2rem;
	}

	h2 {
		margin: 0;
		font-weight: 500;
	}

	.refresh-btn {
		background: #2d3748;
		border: 1px solid #4b5563;
		color: #e2e8f0;
		padding: 0.5rem 1rem;
		border-radius: 6px;
		cursor: pointer;
		font-size: 0.85rem;
		transition: all 0.2s;
	}

	.refresh-btn:hover {
		background: #374151;
	}

	.state-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
		gap: 1.5rem;
	}

	.state-card {
		background: #1e222a;
		border: 1px solid #2d3748;
		border-radius: 8px;
		display: flex;
		flex-direction: column;
	}

	.card-header {
		padding: 1rem;
		border-bottom: 1px solid #2d3748;
		background: #252a33;
		border-radius: 8px 8px 0 0;
	}

	.title-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 0.5rem;
	}

	.id {
		font-family: ui-monospace, SFMono-Regular, monospace;
		font-weight: 600;
		color: #e2e8f0;
		font-size: 0.95rem;
		word-break: break-all;
	}

	.meta-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}

	.badge {
		font-size: 0.7rem;
		font-weight: 700;
		padding: 0.15rem 0.4rem;
		border-radius: 4px;
		text-transform: uppercase;
	}

	.badge.react { background: rgba(97, 218, 251, 0.15); color: #61dafb; }
	.badge.svelte { background: rgba(255, 62, 0, 0.15); color: #ff3e00; }
	.badge.vue { background: rgba(65, 184, 131, 0.15); color: #41b883; }

	.type-badge {
		font-size: 0.7rem;
		background: #374151;
		color: #cbd5e1;
		padding: 0.15rem 0.4rem;
		border-radius: 4px;
	}

	.subs {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		font-size: 0.8rem;
		color: #94a3b8;
	}

	.card-body {
		padding: 1rem;
		flex: 1;
		display: flex;
		flex-direction: column;
	}

	.value-viewer {
		margin: 0 0 1rem 0;
		padding: 0.75rem;
		background: #0f1115;
		border-radius: 4px;
		font-family: ui-monospace, SFMono-Regular, monospace;
		font-size: 0.85rem;
		color: #34d399;
		overflow-x: auto;
		flex: 1;
	}

	.edit-btn {
		background: transparent;
		border: 1px solid #4b5563;
		color: #94a3b8;
		padding: 0.5rem;
		border-radius: 4px;
		cursor: pointer;
		font-size: 0.85rem;
		transition: all 0.2s;
		width: 100%;
	}

	.edit-btn:hover {
		background: #2d3748;
		color: #e2e8f0;
	}

	.editor {
		width: 100%;
		background: #0f1115;
		border: 1px solid #3b82f6;
		color: #e2e8f0;
		padding: 0.75rem;
		border-radius: 4px;
		font-family: ui-monospace, SFMono-Regular, monospace;
		font-size: 0.85rem;
		resize: vertical;
		margin-bottom: 1rem;
		box-sizing: border-box;
	}

	.editor:focus {
		outline: none;
		box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.3);
	}

	.editor-actions {
		display: flex;
		gap: 0.5rem;
		justify-content: flex-end;
	}

	.btn {
		padding: 0.4rem 0.8rem;
		border-radius: 4px;
		font-size: 0.85rem;
		cursor: pointer;
		border: none;
	}

	.btn.primary {
		background: #3b82f6;
		color: white;
	}
	
	.btn.primary:hover {
		background: #2563eb;
	}
	
	.btn.secondary {
		background: #4b5563;
		color: white;
	}

	.btn.secondary:hover {
		background: #374151;
	}

	.btn:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.empty {
		padding: 3rem;
		text-align: center;
		color: #94a3b8;
		background: #1e222a;
		border-radius: 8px;
		border: 1px dashed #4b5563;
		line-height: 1.5;
	}

	@keyframes fadeIn {
		from { opacity: 0; transform: translateY(5px); }
		to { opacity: 1; transform: translateY(0); }
	}
</style>
