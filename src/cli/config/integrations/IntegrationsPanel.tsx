import { useState } from 'react';
import type {
	IntegrationAddResult,
	IntegrationItem,
	IntegrationsPanelState
} from '../../../../types/integrationsPanel';

// The Integrations panel is a thin front-end over the same engine as
// `absolute add <plugin>`: each card shows an integration's live status and an
// install/enable button that POSTs to /api/integrations/add. `config`-kind
// integrations (OpenAPI, OpenTelemetry) wire fully by flipping an absolute.config
// field; `use`-kind ones (CORS, JWT, cron) install the package and show the exact
// `.use(...)` to drop into your server.

type Notice = { kind: 'err' | 'ok'; text: string };

type CardProps = {
	busy: boolean;
	item: IntegrationItem;
	onAdd: () => void;
	onDisable: () => void;
};

const IntegrationCard = ({ busy, item, onAdd, onDisable }: CardProps) => (
	<div className="rule">
		<div className="rule-main">
			<div className="rule-name-row">
				<span className="rule-name">{item.label}</span>
				<span className="badge">
					{item.kind === 'config' ? 'config' : 'plugin'}
				</span>
				{item.installed && item.packages.length > 0 && (
					<span className="badge dep">installed</span>
				)}
				{item.enabled && (
					<span className="badge src">
						{item.kind === 'config' ? 'enabled' : 'ready'}
					</span>
				)}
			</div>
			<p className="rule-desc">{item.blurb}</p>
			{item.note && <p className="intg-note">{item.note}</p>}
			{item.kind === 'use' && item.wiringSnippet && (
				<pre className="intg-code">{item.wiringSnippet}</pre>
			)}
		</div>
		<div className="rule-controls fe-actions">
			<button
				className="ts-btn"
				disabled={busy}
				onClick={onAdd}
				type="button"
			>
				{item.kind === 'config' ? 'enable' : 'install'}
			</button>
			{item.kind === 'config' && item.enabled && (
				<button
					className="ts-clear"
					disabled={busy}
					onClick={onDisable}
					type="button"
				>
					disable
				</button>
			)}
		</div>
	</div>
);

type IntegrationsPanelProps = {
	state: IntegrationsPanelState;
};

export const IntegrationsPanel = ({
	state: initial
}: IntegrationsPanelProps) => {
	const [items, setItems] = useState(initial.items);
	const [busy, setBusy] = useState<string | null>(null);
	const [notice, setNotice] = useState<Notice | null>(null);

	const replaceItem = (next: IntegrationItem) =>
		setItems((prev) =>
			prev.map((entry) => (entry.id === next.id ? next : entry))
		);

	const add = (id: string) => async () => {
		setBusy(id);
		setNotice(null);
		try {
			const response = await fetch('/api/integrations/add', {
				body: JSON.stringify({ id }),
				headers: { 'Content-Type': 'application/json' },
				method: 'POST'
			});
			const result: IntegrationAddResult = await response.json();
			if (result.ok && result.item) {
				replaceItem(result.item);
				setNotice({ kind: 'ok', text: result.message });
			} else {
				setNotice({ kind: 'err', text: result.message });
			}
		} catch (error) {
			setNotice({ kind: 'err', text: String(error) });
		} finally {
			setBusy(null);
		}
	};

	const disable = (item: IntegrationItem) => async () => {
		setBusy(item.id);
		setNotice(null);
		try {
			const response = await fetch('/api/absolute', {
				body: JSON.stringify({ name: item.id, remove: true }),
				headers: { 'Content-Type': 'application/json' },
				method: 'POST'
			});
			const result = await response.json();
			if (result.ok) {
				replaceItem({ ...item, enabled: false });
				setNotice({ kind: 'ok', text: `Disabled ${item.label}.` });
			} else {
				setNotice({ kind: 'err', text: result.message });
			}
		} catch (error) {
			setNotice({ kind: 'err', text: String(error) });
		} finally {
			setBusy(null);
		}
	};

	return (
		<div className="shell">
			<header className="topbar">
				<div className="brand">
					<h1 className="wordmark">
						integrations <em>·plugins</em>
					</h1>
					<div className="subpath">
						<span className="dot" />
						official Elysia plugins — install &amp; wire from here
						or <code>absolute add</code>
					</div>
				</div>
			</header>

			<main>
				<section className="section">
					<div className="section-head">
						<h2 className="section-title">Official plugins</h2>
						<span className="section-files">
							{items.filter((item) => item.enabled).length}{' '}
							enabled
						</span>
					</div>
					{items.map((item) => (
						<IntegrationCard
							busy={busy === item.id}
							item={item}
							key={item.id}
							onAdd={add(item.id)}
							onDisable={disable(item)}
						/>
					))}
				</section>
			</main>

			{notice && (
				<div className={`toast ${notice.kind}`}>
					<b>{notice.kind === 'ok' ? '✓' : '✕'}</b>
					{notice.text}
				</div>
			)}
		</div>
	);
};
