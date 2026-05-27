import { useState } from 'react';
import { AUTH_CORE_ROUTES } from './authCatalog';
import { FieldEditor } from '../page/FieldEditor';
import type {
	AuthConfigEditResult,
	AuthFeatureStatus,
	AuthPanelState,
	AuthScaffoldResult
} from '../../../../types/authPanel';
import type { FieldNode } from '../../../../types/config';

type Notice = { kind: 'err' | 'ok'; text: string };

type SettingRowProps = {
	busy: boolean;
	field: FieldNode;
	isSet: boolean;
	onSave: (value: unknown, remove?: boolean) => void;
	value: unknown;
};

const SettingRow = ({ busy, field, isSet, onSave, value }: SettingRowProps) => {
	const [draft, setDraft] = useState<unknown>(value);

	return (
		<div className="rule fe-block">
			<div className="rule-main">
				<div className="rule-name-row">
					<span className="rule-name">{field.name}</span>
					{isSet && <span className="badge src">set</span>}
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
						unset
					</button>
				)}
			</div>
		</div>
	);
};

type FeatureCardProps = {
	busy: boolean;
	feature: AuthFeatureStatus;
	onScaffold: () => void;
	result: AuthScaffoldResult | null;
};

const FeatureCard = ({
	busy,
	feature,
	onScaffold,
	result
}: FeatureCardProps) => (
	<div className="rule">
		<div className="rule-main">
			<div className="rule-name-row">
				<span className="rule-name">{feature.label}</span>
				<span className="badge dep">{feature.configKey}</span>
				<span className="badge">{feature.kind}</span>
				{feature.configured && (
					<span className="badge src">configured</span>
				)}
			</div>
			<p className="rule-desc">{feature.blurb}</p>
			{result?.spreadSnippet && (
				<pre className="intg-code">{result.spreadSnippet}</pre>
			)}
		</div>
		{!feature.configured && feature.scaffoldable && (
			<div className="rule-controls fe-actions">
				<button
					className="ts-btn"
					disabled={busy}
					onClick={onScaffold}
					type="button"
				>
					{result?.created ? 'scaffolded' : 'scaffold wiring'}
				</button>
			</div>
		)}
	</div>
);

const NotInstalled = ({ npmUrl, repoUrl }: AuthPanelState) => (
	<div className="shell">
		<header className="topbar">
			<div className="brand">
				<h1 className="wordmark">
					auth <em>·@absolutejs/auth</em>
				</h1>
				<div className="subpath">
					<span className="dot" />
					not installed in this project
				</div>
			</div>
		</header>
		<main>
			<section className="section">
				<p className="rule-desc">
					Enterprise auth for AbsoluteJS — OAuth2, credentials, SSO,
					SCIM, MFA, passkeys, organizations, and more. Install it,
					then this panel introspects your setup.
				</p>
				<pre className="intg-code">bun add @absolutejs/auth</pre>
				<div className="auth-links">
					<a
						className="auth-link"
						href={repoUrl}
						rel="noreferrer"
						target="_blank"
					>
						GitHub ↗
					</a>
					<a
						className="auth-link"
						href={npmUrl}
						rel="noreferrer"
						target="_blank"
					>
						npm ↗
					</a>
				</div>
			</section>
		</main>
	</div>
);

type AuthPanelProps = {
	state: AuthPanelState;
};

export const AuthPanel = ({ state: initial }: AuthPanelProps) => {
	const [state, setState] = useState(initial);
	const [busy, setBusy] = useState<string | null>(null);
	const [notice, setNotice] = useState<Notice | null>(null);
	const [results, setResults] = useState<Record<string, AuthScaffoldResult>>(
		{}
	);

	const saveSetting =
		(name: string) => async (value: unknown, remove?: boolean) => {
			setBusy(`setting:${name}`);
			setNotice(null);
			try {
				const response = await fetch('/api/auth', {
					body: JSON.stringify({ name, remove, value }),
					headers: { 'Content-Type': 'application/json' },
					method: 'POST'
				});
				const result: AuthConfigEditResult = await response.json();
				if (result.ok && result.state) {
					setState(result.state);
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

	const scaffold = (id: string) => async () => {
		setBusy(id);
		setNotice(null);
		try {
			const response = await fetch('/api/auth/scaffold', {
				body: JSON.stringify({ id }),
				headers: { 'Content-Type': 'application/json' },
				method: 'POST'
			});
			const result: AuthScaffoldResult = await response.json();
			setResults((prev) => ({ ...prev, [id]: result }));
			setNotice({ kind: result.ok ? 'ok' : 'err', text: result.message });
		} catch (error) {
			setNotice({ kind: 'err', text: String(error) });
		} finally {
			setBusy(null);
		}
	};

	if (!state.installed) return <NotInstalled {...state} />;

	const configuredCount = state.features.filter(
		(feature) => feature.configured
	).length;
	const version = state.installedVersion ?? state.declaredVersion ?? '—';
	const { settings } = state;
	const canEditSettings = settings.available && settings.configPath !== null;

	return (
		<div className="shell">
			<header className="topbar">
				<div className="brand">
					<h1 className="wordmark">
						auth <em>·@absolutejs/auth</em>
					</h1>
					<div className="subpath">
						<span className="dot" />
						{state.setupPath ?? 'no auth() call found'}
					</div>
				</div>
				<div className="counts">
					<div className="count">
						<b>{version}</b>
						<span>version</span>
					</div>
					<div className="count">
						<b>{configuredCount}</b>
						<span>features on</span>
					</div>
				</div>
			</header>

			<main>
				{state.introspected ? (
					<div className="auth-banner">
						Detected your <code>auth()</code> setup
						{state.setupPath ? ` in ${state.setupPath}` : ''}
						{state.providerCount === null
							? ''
							: ` · ${state.providerCount} OAuth providers`}
						{state.usesSpread
							? ' · config uses a spread, some keys may be hidden'
							: ''}
						.
					</div>
				) : (
					<div className="auth-banner warn">
						Couldn’t find an <code>auth()</code> call to introspect
						— showing the full capability catalog as a reference.
						Features are configured in code where you call{' '}
						<code>auth()</code>.
					</div>
				)}

				<section className="section">
					<div className="section-head">
						<h2 className="section-title">Core OAuth2 routes</h2>
						<span className="section-files">always mounted</span>
					</div>
					<div className="auth-chips">
						{AUTH_CORE_ROUTES.map((route) => (
							<span className="auth-chip" key={route}>
								{route}
							</span>
						))}
					</div>
				</section>

				<section className="section">
					<div className="section-head">
						<h2 className="section-title">Features</h2>
						<span className="section-files">
							{configuredCount} of {state.features.length}{' '}
							configured
						</span>
					</div>
					{state.features.map((feature) => (
						<FeatureCard
							busy={busy === feature.id}
							feature={feature}
							key={feature.id}
							onScaffold={scaffold(feature.id)}
							result={results[feature.id] ?? null}
						/>
					))}
				</section>

				<section className="section">
					<div className="section-head">
						<h2 className="section-title">Settings</h2>
						<span className="section-files">
							{settings.configPath ?? 'auth.config.ts'}
						</span>
					</div>
					{!settings.available && (
						<p className="rule-desc">
							Upgrade <code>@absolutejs/auth</code> to a version
							that exports <code>AuthSettings</code> to edit
							settings here.
						</p>
					)}
					{settings.available && settings.configPath === null && (
						<p className="rule-desc">
							Create an <code>auth.config.ts</code> exporting{' '}
							<code>{'defineAuthSettings({})'}</code> and spread
							it into your <code>auth()</code> call, then edit the
							route paths, durations, and limits here.
						</p>
					)}
					{canEditSettings &&
						settings.fields.map((field) => (
							<SettingRow
								busy={busy === `setting:${field.name}`}
								field={field}
								isSet={Object.prototype.hasOwnProperty.call(
									settings.current,
									field.name
								)}
								key={field.name}
								onSave={saveSetting(field.name)}
								value={settings.current[field.name]}
							/>
						))}
				</section>

				<section className="section">
					<div className="section-head">
						<h2 className="section-title">Related</h2>
					</div>
					<p className="rule-desc">
						Signing your own API/service tokens (not user login)?
						See <code>@elysiajs/jwt</code> in the{' '}
						<a className="auth-link" href="/integrations">
							Integrations panel
						</a>
						.
					</p>
					<div className="auth-links">
						<a
							className="auth-link"
							href={`${state.repoUrl}#features`}
							rel="noreferrer"
							target="_blank"
						>
							Features ↗
						</a>
						<a
							className="auth-link"
							href={`${state.repoUrl}#configuration-options`}
							rel="noreferrer"
							target="_blank"
						>
							Configuration ↗
						</a>
						<a
							className="auth-link"
							href={state.npmUrl}
							rel="noreferrer"
							target="_blank"
						>
							npm ↗
						</a>
					</div>
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
