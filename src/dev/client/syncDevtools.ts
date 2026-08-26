import {
	discardSyncRuntimeDeadLetter,
	inspectSyncRuntime,
	rebaseSyncRuntimeDeadLetter,
	retrySyncRuntimeDeadLetter,
	type SyncRuntimeInspection
} from '@absolutejs/sync/client/runtime';

export type SyncDevtoolsBridge = {
	discard: (operationId: string) => Promise<void>;
	inspect: () => Promise<SyncRuntimeInspection>;
	rebase: (operationId: string, args: unknown) => Promise<string>;
	retry: (operationId: string) => Promise<void>;
};

const DEVTOOLS_ID = 'absolutejs-sync-devtools';
const REFRESH_INTERVAL_MS = 1_500;
const bridge: SyncDevtoolsBridge = {
	discard: discardSyncRuntimeDeadLetter,
	inspect: inspectSyncRuntime,
	rebase: rebaseSyncRuntimeDeadLetter,
	retry: retrySyncRuntimeDeadLetter
};

const time = (value: number | undefined) =>
	value === undefined ? '—' : new Date(value).toLocaleTimeString();

const styles = `
:host { all: initial; color-scheme: light dark; }
button { font: inherit; }
.trigger { position:fixed;right:max(12px,env(safe-area-inset-right));bottom:max(12px,env(safe-area-inset-bottom));z-index:2147483645;border:0;border-radius:999px;padding:9px 13px;background:#111827;color:#fff;box-shadow:0 4px 18px #0006;font:600 12px/1.2 ui-monospace,SFMono-Regular,Menlo,monospace; }
.trigger[data-alert=true] { background:#b91c1c; }
.panel { position:fixed;inset:max(12px,env(safe-area-inset-top)) max(12px,env(safe-area-inset-right)) max(56px,env(safe-area-inset-bottom)) auto;z-index:2147483645;width:min(420px,calc(100vw - 24px));max-height:calc(100vh - 80px);overflow:auto;border:1px solid #64748b66;border-radius:14px;background:#fffffff2;color:#111827;box-shadow:0 16px 48px #0008;font:12px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;backdrop-filter:blur(12px); }
[hidden] { display:none!important; }
header { position:sticky;top:0;display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border-bottom:1px solid #64748b44;background:inherit; }
h2 { margin:0;font-size:14px; }
.close,.action { border:1px solid #64748b66;border-radius:7px;background:transparent;color:inherit;padding:5px 8px; }
.body { padding:12px 14px; }
.metrics { display:grid;grid-template-columns:repeat(2,1fr);gap:7px;margin-bottom:12px; }
.metric { padding:8px;border-radius:8px;background:#64748b18; }
.metric strong { display:block;font-size:16px; }
.empty { color:#64748b; }
.letter { margin-top:9px;padding:10px;border:1px solid #ef444466;border-radius:9px;overflow-wrap:anywhere; }
.letter strong { display:block; }
.meta { color:#64748b;margin:4px 0 8px; }
.actions { display:flex;flex-wrap:wrap;gap:6px; }
.danger { color:#b91c1c; }
.notice { margin-bottom:9px;padding:8px;border-radius:7px;background:#f59e0b22; }
@media (prefers-color-scheme:dark) { .panel { background:#111827f2;color:#f8fafc; } .empty,.meta { color:#94a3b8; } .danger { color:#fca5a5; } }
`;

const renderInspection = (
	body: HTMLElement,
	inspection: SyncRuntimeInspection,
	notice?: string
) => {
	body.replaceChildren();
	if (notice) {
		const message = document.createElement('div');
		message.className = 'notice';
		message.textContent = notice;
		body.appendChild(message);
	}
	const metrics = document.createElement('div');
	metrics.className = 'metrics';
	for (const [label, value] of [
		['Pending', inspection.pending],
		['Dead letters', inspection.deadLetters.length],
		['Conflicts', inspection.conflicts],
		['Auto-resolved', inspection.automaticResolutions]
	] as const) {
		const metric = document.createElement('div');
		metric.className = 'metric';
		const strong = document.createElement('strong');
		strong.textContent = String(value);
		metric.append(strong, label);
		metrics.appendChild(metric);
	}
	body.appendChild(metrics);
	const activity = document.createElement('div');
	activity.className = 'meta';
	activity.textContent = `Clients ${inspection.clients} · last push ${time(inspection.lastSuccessfulPushAt)} · last pull ${time(inspection.lastSuccessfulPullAt)}`;
	body.appendChild(activity);
	if (inspection.deadLetters.length === 0) {
		const empty = document.createElement('div');
		empty.className = 'empty';
		empty.textContent = 'No mutations need manual remediation.';
		body.appendChild(empty);

		return;
	}
	for (const deadLetter of inspection.deadLetters) {
		const item = document.createElement('section');
		item.className = 'letter';
		const title = document.createElement('strong');
		title.textContent = deadLetter.name;
		const metadata = document.createElement('div');
		metadata.className = 'meta';
		metadata.textContent = `${deadLetter.kind ?? 'rejected'}${deadLetter.code ? ` · ${deadLetter.code}` : ''} · attempts ${deadLetter.attempts} · ${time(deadLetter.deadLetteredAt)}`;
		const detail = document.createElement('div');
		detail.textContent =
			deadLetter.message ?? 'The server rejected this mutation.';
		const actions = document.createElement('div');
		actions.className = 'actions';
		for (const [action, label] of [
			['retry', 'Retry unchanged'],
			['rebase', 'Rebase with new args'],
			['discard', 'Discard']
		] as const) {
			const button = document.createElement('button');
			button.className = `action${action === 'discard' ? ' danger' : ''}`;
			button.dataset.action = action;
			button.dataset.operationId = deadLetter.operationId;
			button.textContent = label;
			actions.appendChild(button);
		}
		item.append(title, metadata, detail, actions);
		body.appendChild(item);
	}
};

/** Install the development-only, framework-neutral native Sync panel. */
export const installAbsoluteNativeSyncDevtools = (
	devtoolsBridge: SyncDevtoolsBridge = bridge
) => {
	if (typeof document === 'undefined' || !document.body)
		return () => undefined;
	if (document.getElementById(DEVTOOLS_ID)) return () => undefined;
	const host = document.createElement('aside');
	host.id = DEVTOOLS_ID;
	host.dataset.hmrOverlay = 'true';
	const root = host.attachShadow({ mode: 'open' });
	const style = document.createElement('style');
	style.textContent = styles;
	const trigger = document.createElement('button');
	trigger.className = 'trigger';
	trigger.textContent = 'Sync';
	trigger.type = 'button';
	const panel = document.createElement('section');
	panel.className = 'panel';
	panel.hidden = true;
	const header = document.createElement('header');
	const title = document.createElement('h2');
	title.textContent = 'AbsoluteJS Sync';
	const close = document.createElement('button');
	close.className = 'close';
	close.textContent = 'Close';
	close.type = 'button';
	header.append(title, close);
	const body = document.createElement('div');
	body.className = 'body';
	panel.append(header, body);
	root.append(style, trigger, panel);
	document.body.appendChild(host);
	let active = true;
	let notice: string | undefined;
	const refresh = async () => {
		try {
			const inspection = await devtoolsBridge.inspect();
			if (!active) return;
			trigger.dataset.alert = String(inspection.deadLetters.length > 0);
			trigger.textContent = inspection.deadLetters.length
				? `Sync · ${inspection.deadLetters.length}`
				: 'Sync';
			if (!panel.hidden) renderInspection(body, inspection, notice);
			notice = undefined;
		} catch {
			if (!active || panel.hidden) return;
			notice = 'Sync diagnostics are temporarily unavailable.';
		}
	};
	trigger.addEventListener('click', () => {
		panel.hidden = !panel.hidden;
		if (!panel.hidden) void refresh();
	});
	close.addEventListener('click', () => {
		panel.hidden = true;
	});
	const remediate = async (
		action: string | undefined,
		operationId: string
	) => {
		try {
			if (action === 'retry') await devtoolsBridge.retry(operationId);
			else if (action === 'discard') {
				if (
					!globalThis.confirm(
						'Discard this local mutation permanently?'
					)
				)
					return;
				await devtoolsBridge.discard(operationId);
			} else if (action === 'rebase') {
				const serialized = globalThis.prompt(
					'New mutation arguments as JSON. This creates a new operation intent:'
				);
				if (serialized === null) return;
				let args: unknown;
				try {
					args = JSON.parse(serialized);
				} catch {
					notice = 'Rebase cancelled: arguments were not valid JSON.';
					await refresh();

					return;
				}
				if (
					!globalThis.confirm(
						'Create a new mutation with these arguments?'
					)
				)
					return;
				await devtoolsBridge.rebase(operationId, args);
			}
			notice = 'Sync remediation applied.';
		} catch {
			notice =
				'Sync remediation failed. The local mutation was retained.';
		}
		await refresh();
	};
	body.addEventListener('click', (event) => {
		if (!(event.target instanceof HTMLButtonElement)) return;
		const { action, operationId } = event.target.dataset;
		if (!operationId) return;
		void remediate(action, operationId);
	});
	const interval = setInterval(() => void refresh(), REFRESH_INTERVAL_MS);
	void refresh();

	return () => {
		active = false;
		clearInterval(interval);
		host.remove();
	};
};
