import { useEffect, useState } from 'react';
import { EslintPanel } from '../eslint/EslintPanel';
import { TsconfigPanel } from '../tsconfig/TsconfigPanel';
import { PrettierPanel } from '../prettier/PrettierPanel';
import { AbsoluteConfigPanel } from '../absolute/AbsoluteConfigPanel';
import { IntegrationsPanel } from '../integrations/IntegrationsPanel';
import { AuthPanel } from '../auth/AuthPanel';
import { PackageJsonPanel } from '../packageJson/PackageJsonPanel';
import { isRecord } from '../guards';
import type { ConfigPanelId } from '../../../../types/config';
import type { RuleCatalog } from '../../../../types/eslintConfig';
import type { TsConfigState } from '../../../../types/tsconfig';
import type { PrettierState } from '../../../../types/prettier';
import type { AbsoluteConfigState } from '../../../../types/absoluteConfig';
import type { AuthPanelState } from '../../../../types/authPanel';
import type { PackageJsonState } from '../../../../types/packageJsonPanel';

const ENDPOINTS: Record<ConfigPanelId, string> = {
	absolute: '/api/absolute',
	auth: '/api/auth',
	eslint: '/api/rules',
	integrations: '/api/absolute',
	package: '/api/package',
	prettier: '/api/prettier',
	tsconfig: '/api/tsconfig'
};

const LABELS: Record<ConfigPanelId, string> = {
	absolute: 'absolute.config',
	auth: 'Auth',
	eslint: 'ESLint',
	integrations: 'Integrations',
	package: 'package.json',
	prettier: 'Prettier',
	tsconfig: 'tsconfig'
};

type MessageProps = {
	body: string;
	title: string;
};

const Message = ({ body, title }: MessageProps) => (
	<div className="cfg-placeholder">
		<h2 className="cfg-placeholder-title">{title}</h2>
		<p className="cfg-placeholder-text">{body}</p>
	</div>
);

const Skeleton = ({ label }: { label: string }) => (
	<div className="cfg-placeholder">
		<h2 className="cfg-placeholder-title cfg-loading">Loading {label}…</h2>
		<p className="cfg-placeholder-text">Reading your configuration.</p>
	</div>
);

const isCatalog = (value: unknown): value is RuleCatalog =>
	isRecord(value) && Array.isArray(value.meta) && Array.isArray(value.blocks);
const isTsState = (value: unknown): value is TsConfigState =>
	isRecord(value) && Array.isArray(value.options);
const isPrettierState = (value: unknown): value is PrettierState =>
	isRecord(value) && Array.isArray(value.options);
const isAbsoluteState = (value: unknown): value is AbsoluteConfigState =>
	isRecord(value) && Array.isArray(value.fields);
const isAuthState = (value: unknown): value is AuthPanelState =>
	isRecord(value) && Array.isArray(value.features);
const isPackageState = (value: unknown): value is PackageJsonState =>
	isRecord(value) &&
	Array.isArray(value.scripts) &&
	Array.isArray(value.fields);

const renderPanel = (panel: ConfigPanelId, data: unknown) => {
	if (panel === 'eslint') {
		return isCatalog(data) && data.configPath ? (
			<EslintPanel catalog={data} />
		) : (
			<Message
				body="No flat ESLint config (eslint.config.{js,mjs,cjs,ts}) was found in this project."
				title="No ESLint config"
			/>
		);
	}
	if (panel === 'tsconfig') {
		return isTsState(data) && data.configPath ? (
			<TsconfigPanel state={data} />
		) : (
			<Message
				body="No tsconfig.json or jsconfig.json was found in this project."
				title="No tsconfig found"
			/>
		);
	}
	if (panel === 'prettier') {
		return isPrettierState(data) && data.editable ? (
			<PrettierPanel state={data} />
		) : (
			<Message
				body="Prettier isn't installed, or your config uses a JS/YAML format this editor can't rewrite. Switch to .prettierrc.json to edit it here."
				title="Prettier unavailable"
			/>
		);
	}
	if (panel === 'absolute') {
		return isAbsoluteState(data) && data.configPath ? (
			<AbsoluteConfigPanel state={data} />
		) : (
			<Message
				body="No absolute.config.ts was found. Run with --config <path> to point at one."
				title="No absolute.config"
			/>
		);
	}
	if (panel === 'integrations') {
		return isAbsoluteState(data) && data.configPath ? (
			<IntegrationsPanel state={data} />
		) : (
			<Message
				body="No absolute.config.ts was found. Run with --config <path> to point at one."
				title="No absolute.config"
			/>
		);
	}
	if (panel === 'auth') {
		return isAuthState(data) ? (
			<AuthPanel state={data} />
		) : (
			<Message
				body="Couldn't read the @absolutejs/auth setup for this project."
				title="Auth unavailable"
			/>
		);
	}
	if (panel === 'package') {
		return isPackageState(data) && data.configPath ? (
			<PackageJsonPanel state={data} />
		) : (
			<Message
				body="No package.json was found in this project."
				title="No package.json"
			/>
		);
	}

	return null;
};

type PanelHostProps = {
	panel: ConfigPanelId;
};

// Renders a skeleton immediately (so the shell paints instantly) and fetches
// the panel's data client-side — keeping the heavy resolution (TS-type
// introspection, ESLint load) off the server render path.
export const PanelHost = ({ panel }: PanelHostProps) => {
	const [data, setData] = useState<unknown>(null);
	const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>(
		'loading'
	);

	useEffect(() => {
		let active = true;
		setPhase('loading');
		fetch(ENDPOINTS[panel])
			.then((response) => response.json())
			.then((result) => {
				if (!active) return;
				setData(result);
				setPhase('ready');
			})
			.catch(() => {
				if (active) setPhase('error');
			});

		return () => {
			active = false;
		};
	}, [panel]);

	if (phase === 'loading') return <Skeleton label={LABELS[panel]} />;
	if (phase === 'error') {
		return (
			<Message
				body="The config server didn't respond — check the terminal where it's running."
				title="Couldn't load"
			/>
		);
	}

	return renderPanel(panel, data);
};
