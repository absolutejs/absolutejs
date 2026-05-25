import { useState } from 'react';
import { FieldEditor } from '../page/FieldEditor';
import type {
	AbsoluteConfigEditResult,
	AbsoluteConfigState
} from '../../../../types/absoluteConfig';
import type { FieldNode } from '../../../../types/config';

// The Integrations panel reuses the absolute.config state + edit endpoint, but
// presents the config-driven official Elysia plugins (OpenAPI, OpenTelemetry) as
// a curated home, plus a manual-setup section for the plugins that need their own
// install + wiring (CORS, JWT, cron).

type ConfigIntegration = {
	field: string;
	title: string;
};

const CONFIG_INTEGRATIONS: ConfigIntegration[] = [
	{ field: 'openapi', title: 'OpenAPI' },
	{ field: 'telemetry', title: 'OpenTelemetry' }
];

type ManualPlugin = {
	blurb: string;
	id: string;
	install: string;
	note?: string;
	wire: string;
};

const MANUAL_PLUGINS: ManualPlugin[] = [
	{
		blurb: 'Cross-origin resource sharing (CORS) headers.',
		id: '@elysiajs/cors',
		install: 'bun add @elysiajs/cors',
		wire: '.use(cors())'
	},
	{
		blurb: 'Sign and verify your own JWTs — custom API/service tokens.',
		id: '@elysiajs/jwt',
		install: 'bun add @elysiajs/jwt',
		note: 'Not for user login. For authentication (OAuth2, SSO, MFA, passkeys, sessions) use the Auth panel + @absolutejs/auth.',
		wire: ".use(jwt({ name: 'jwt', secret: getEnv('JWT_SECRET') }))"
	},
	{
		blurb: 'Scheduled jobs on a cron pattern.',
		id: '@elysiajs/cron',
		install: 'bun add @elysiajs/cron',
		wire: ".use(cron({ name: 'heartbeat', pattern: '0 */6 * * *', run() {} }))"
	}
];

const ManualPluginCard = ({ blurb, id, install, note, wire }: ManualPlugin) => (
	<div className="rule">
		<div className="rule-main">
			<div className="rule-name-row">
				<span className="rule-name">{id}</span>
			</div>
			<p className="rule-desc">{blurb}</p>
			{note && <p className="intg-note">{note}</p>}
			<pre className="intg-code">{install}</pre>
			<pre className="intg-code">{wire}</pre>
		</div>
	</div>
);

type Notice = { kind: 'err' | 'ok'; text: string };

type FieldRowProps = {
	busy: boolean;
	field: FieldNode;
	isSet: boolean;
	onSave: (value: unknown, remove?: boolean) => void;
	title: string;
	value: unknown;
};

const FieldRow = ({ busy, field, isSet, onSave, title, value }: FieldRowProps) => {
	const [draft, setDraft] = useState<unknown>(value);

	return (
		<div className="rule fe-block">
			<div className="rule-main">
				<div className="rule-name-row">
					<span className="rule-name">{title}</span>
					<span className="badge dep">{field.name}</span>
					{isSet && <span className="badge src">on</span>}
				</div>
				{field.description !== '' && (
					<p className="rule-desc">{field.description}</p>
				)}
				<div className="fe-root">
					<FieldEditor
						onChange={setDraft}
						schema={field.schema}
						value={draft}
					/>
				</div>
			</div>
			<div className="rule-controls fe-actions">
				<button
					className="ts-btn"
					disabled={busy}
					onClick={() => onSave(draft)}
					type="button"
				>
					save
				</button>
				{isSet && (
					<button
						className="ts-clear"
						onClick={() => onSave(undefined, true)}
						type="button"
					>
						disable
					</button>
				)}
			</div>
		</div>
	);
};

type IntegrationsPanelProps = {
	state: AbsoluteConfigState;
};

export const IntegrationsPanel = ({
	state: initial
}: IntegrationsPanelProps) => {
	const [state, setState] = useState(initial);
	const [busy, setBusy] = useState<string | null>(null);
	const [notice, setNotice] = useState<Notice | null>(null);

	const save = (name: string) => async (value: unknown, remove?: boolean) => {
		setBusy(name);
		setNotice(null);
		try {
			const response = await fetch('/api/absolute', {
				body: JSON.stringify({ name, remove, value }),
				headers: { 'Content-Type': 'application/json' },
				method: 'POST'
			});
			const result: AbsoluteConfigEditResult = await response.json();
			if (result.ok && result.state) {
				setState(result.state);
				setNotice({ kind: 'ok', text: result.message });
			} else {
				setNotice({
					kind: 'err',
					text: result.message ?? 'Update failed'
				});
			}
		} catch (error) {
			setNotice({ kind: 'err', text: String(error) });
		} finally {
			setBusy(null);
		}
	};

	const rows = CONFIG_INTEGRATIONS.map((entry) => ({
		field: state.fields.find((candidate) => candidate.name === entry.field),
		title: entry.title
	})).filter((row): row is { field: FieldNode; title: string } =>
		Boolean(row.field)
	);

	return (
		<div className="shell">
			<header className="topbar">
				<div className="brand">
					<h1 className="wordmark">
						integrations <em>·plugins</em>
					</h1>
					<div className="subpath">
						<span className="dot" />
						official Elysia plugins, wired the AbsoluteJS way
					</div>
				</div>
			</header>

			<main>
				<section className="section">
					<div className="section-head">
						<h2 className="section-title">Config-driven</h2>
						<span className="section-files">
							toggle in absolute.config.ts
						</span>
					</div>
					{rows.map((row) => (
						<FieldRow
							busy={busy === row.field.name}
							field={row.field}
							isSet={Object.prototype.hasOwnProperty.call(
								state.current,
								row.field.name
							)}
							key={row.field.name}
							onSave={save(row.field.name)}
							title={row.title}
							value={state.current[row.field.name]}
						/>
					))}
				</section>

				<section className="section">
					<div className="section-head">
						<h2 className="section-title">More official plugins</h2>
						<span className="section-files">install + wire</span>
					</div>
					{MANUAL_PLUGINS.map((plugin) => (
						<ManualPluginCard key={plugin.id} {...plugin} />
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
