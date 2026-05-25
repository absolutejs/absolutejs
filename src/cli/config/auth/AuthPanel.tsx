import { AUTH_CORE_ROUTES } from './authCatalog';
import type { AuthFeatureStatus, AuthPanelState } from '../../../../types/authPanel';

const FeatureCard = ({ blurb, configKey, configured, kind, label }: AuthFeatureStatus) => (
	<div className="rule">
		<div className="rule-main">
			<div className="rule-name-row">
				<span className="rule-name">{label}</span>
				<span className="badge dep">{configKey}</span>
				<span className="badge">{kind}</span>
				{configured && <span className="badge src">configured</span>}
			</div>
			<p className="rule-desc">{blurb}</p>
		</div>
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
					SCIM, MFA, passkeys, organizations, and more. Install it, then
					this panel introspects your setup.
				</p>
				<pre className="intg-code">bun add @absolutejs/auth</pre>
				<div className="auth-links">
					<a className="auth-link" href={repoUrl} rel="noreferrer" target="_blank">
						GitHub ↗
					</a>
					<a className="auth-link" href={npmUrl} rel="noreferrer" target="_blank">
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

export const AuthPanel = ({ state }: AuthPanelProps) => {
	if (!state.installed) return <NotInstalled {...state} />;

	const configuredCount = state.features.filter(
		(feature) => feature.configured
	).length;
	const version = state.installedVersion ?? state.declaredVersion ?? '—';

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
						Couldn’t find an <code>auth()</code> call to introspect —
						showing the full capability catalog as a reference. Features
						are configured in code where you call <code>auth()</code>.
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
							{configuredCount} of {state.features.length} configured
						</span>
					</div>
					{state.features.map((feature) => (
						<FeatureCard key={feature.id} {...feature} />
					))}
				</section>

				<section className="section">
					<div className="section-head">
						<h2 className="section-title">Related</h2>
					</div>
					<p className="rule-desc">
						Signing your own API/service tokens (not user login)? See{' '}
						<code>@elysiajs/jwt</code> in the{' '}
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
		</div>
	);
};
