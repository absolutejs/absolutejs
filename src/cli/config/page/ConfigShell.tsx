import { EslintPanel } from '../eslint/EslintPanel';
import { ESLINT_CSS } from '../eslint/eslintStyles';
import { TsconfigPanel } from '../tsconfig/TsconfigPanel';
import { TSCONFIG_CSS } from '../tsconfig/tsconfigStyles';
import { PrettierPanel } from '../prettier/PrettierPanel';
import { AbsoluteConfigPanel } from '../absolute/AbsoluteConfigPanel';
import { PackageJsonPanel } from '../packageJson/PackageJsonPanel';
import { CONFIG_CSS } from './configStyles';
import { CONFIG_PANELS } from '../panels';
import type { ConfigPanelId, ConfigPanelMeta } from '../../../../types/config';
import type { RuleCatalog } from '../../../../types/eslintConfig';
import type { TsConfigState } from '../../../../types/tsconfig';
import type { PrettierState } from '../../../../types/prettier';
import type { AbsoluteConfigState } from '../../../../types/absoluteConfig';
import type { PackageJsonState } from '../../../../types/packageJson';

type ConfigShellProps = {
	absoluteConfigState: AbsoluteConfigState | null;
	eslintCatalog: RuleCatalog | null;
	packageJsonState: PackageJsonState | null;
	panel: ConfigPanelId;
	prettierState: PrettierState | null;
	tsconfigState: TsConfigState | null;
};

type NavItemProps = {
	active: boolean;
	panel: ConfigPanelMeta;
};

const NavItem = ({ active, panel }: NavItemProps) => (
	<a
		className="cfg-item"
		data-active={active}
		data-soon={panel.status === 'soon'}
		href={`/${panel.id}`}
	>
		<span className="cfg-item-top">
			<span className="cfg-item-name">{panel.label}</span>
			{panel.status === 'soon' && <span className="cfg-soon">soon</span>}
		</span>
		<span className="cfg-item-blurb">{panel.blurb}</span>
	</a>
);

type PlaceholderProps = {
	body: string;
	title: string;
};

const Placeholder = ({ body, title }: PlaceholderProps) => (
	<div className="cfg-placeholder">
		<h2 className="cfg-placeholder-title">
			{title} <em>coming soon</em>
		</h2>
		<p className="cfg-placeholder-text">{body}</p>
	</div>
);

type RenderBodyArgs = {
	absoluteConfigState: AbsoluteConfigState | null;
	active: ConfigPanelMeta | undefined;
	eslintCatalog: RuleCatalog | null;
	packageJsonState: PackageJsonState | null;
	panel: ConfigPanelId;
	prettierState: PrettierState | null;
	tsconfigState: TsConfigState | null;
};

const renderBody = ({
	absoluteConfigState,
	active,
	eslintCatalog,
	packageJsonState,
	panel,
	prettierState,
	tsconfigState
}: RenderBodyArgs) => {
	if (panel === 'absolute') {
		if (absoluteConfigState?.configPath) {
			return <AbsoluteConfigPanel state={absoluteConfigState} />;
		}

		return (
			<div className="cfg-placeholder">
				<h2 className="cfg-placeholder-title">
					No <em>absolute.config</em>
				</h2>
				<p className="cfg-placeholder-text">
					No absolute.config.ts was found in this project.
				</p>
			</div>
		);
	}

	if (panel === 'package') {
		if (packageJsonState?.configPath) {
			return <PackageJsonPanel state={packageJsonState} />;
		}

		return (
			<div className="cfg-placeholder">
				<h2 className="cfg-placeholder-title">
					No <em>package.json</em>
				</h2>
				<p className="cfg-placeholder-text">
					No package.json was found in this project.
				</p>
			</div>
		);
	}

	if (panel === 'eslint') {
		if (eslintCatalog) return <EslintPanel catalog={eslintCatalog} />;

		return (
			<div className="cfg-placeholder">
				<h2 className="cfg-placeholder-title">
					No <em>ESLint</em> config
				</h2>
				<p className="cfg-placeholder-text">
					No flat ESLint config
					(eslint.config.&#123;js,mjs,cjs,ts&#125;) was found in this
					project.
				</p>
			</div>
		);
	}

	if (panel === 'tsconfig') {
		if (tsconfigState?.configPath) {
			return <TsconfigPanel state={tsconfigState} />;
		}

		return (
			<div className="cfg-placeholder">
				<h2 className="cfg-placeholder-title">
					No <em>tsconfig</em> found
				</h2>
				<p className="cfg-placeholder-text">
					No tsconfig.json or jsconfig.json was found in this project.
				</p>
			</div>
		);
	}

	if (panel === 'prettier') {
		if (prettierState?.editable) {
			return <PrettierPanel state={prettierState} />;
		}

		return (
			<div className="cfg-placeholder">
				<h2 className="cfg-placeholder-title">
					Prettier <em>unavailable</em>
				</h2>
				<p className="cfg-placeholder-text">
					{prettierState && !prettierState.available
						? 'Prettier is not installed in this project.'
						: 'Your prettier config uses a JS/YAML format that this editor cannot rewrite. Switch to .prettierrc.json to edit it here.'}
				</p>
			</div>
		);
	}

	if (active) {
		return (
			<Placeholder
				body={`This panel will let you edit ${active.blurb.toLowerCase()} from the same place. It's next on the list.`}
				title={active.label}
			/>
		);
	}

	return null;
};

export const ConfigShell = ({
	absoluteConfigState,
	eslintCatalog,
	packageJsonState,
	panel,
	prettierState,
	tsconfigState
}: ConfigShellProps) => {
	const active = CONFIG_PANELS.find((entry) => entry.id === panel);
	const activeLabel = active?.label ?? 'Config';

	return (
		<html lang="en">
			<head>
				<meta charSet="utf-8" />
				<meta
					content="width=device-width, initial-scale=1"
					name="viewport"
				/>
				<title>{`Absolute Config · ${activeLabel}`}</title>
				<link href="https://fonts.googleapis.com" rel="preconnect" />
				<link
					crossOrigin="anonymous"
					href="https://fonts.gstatic.com"
					rel="preconnect"
				/>
				<link
					href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=JetBrains+Mono:wght@400;500&display=swap"
					rel="stylesheet"
				/>
				<style
					dangerouslySetInnerHTML={{
						__html: ESLINT_CSS + TSCONFIG_CSS + CONFIG_CSS
					}}
				/>
			</head>
			<body>
				<div className="cfg">
					<aside className="cfg-nav">
						<div className="cfg-brand">
							<span className="cfg-word">
								absolute <em>config</em>
							</span>
							<span className="cfg-tag">project tooling</span>
						</div>
						<nav className="cfg-panels">
							<div className="cfg-rail-label">Panels</div>
							{CONFIG_PANELS.map((entry) => (
								<NavItem
									active={entry.id === panel}
									key={entry.id}
									panel={entry}
								/>
							))}
						</nav>
					</aside>
					<main className="cfg-main">
						{renderBody({
							absoluteConfigState,
							active,
							eslintCatalog,
							packageJsonState,
							panel,
							prettierState,
							tsconfigState
						})}
					</main>
				</div>
			</body>
		</html>
	);
};
