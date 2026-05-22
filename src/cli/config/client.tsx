import { createElement } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { ConfigShell } from './page/ConfigShell';
import { DEFAULT_PANEL, isConfigPanelId } from './panels';
import { isRecord } from './guards';
import type { ConfigPanelId } from '../../../types/config';
import type { RuleCatalog } from '../../../types/eslintConfig';
import type { TsConfigState } from '../../../types/tsconfig';
import type { PrettierState } from '../../../types/prettier';
import type { AbsoluteConfigState } from '../../../types/absoluteConfig';
import type { PackageJsonState } from '../../../types/packageJson';

type ShellProps = {
	absoluteConfigState: AbsoluteConfigState | null;
	eslintCatalog: RuleCatalog | null;
	packageJsonState: PackageJsonState | null;
	panel: ConfigPanelId;
	prettierState: PrettierState | null;
	tsconfigState: TsConfigState | null;
};

const isCatalog = (value: unknown): value is RuleCatalog =>
	isRecord(value) && Array.isArray(value.meta) && Array.isArray(value.blocks);

const isTsState = (value: unknown): value is TsConfigState =>
	isRecord(value) && Array.isArray(value.options);

const isPrettierState = (value: unknown): value is PrettierState =>
	isRecord(value) && Array.isArray(value.options);

const isAbsoluteState = (value: unknown): value is AbsoluteConfigState =>
	isRecord(value) && Array.isArray(value.fields);

const isPackageState = (value: unknown): value is PackageJsonState =>
	isRecord(value) &&
	Array.isArray(value.scripts) &&
	Array.isArray(value.fields);

const readShellProps = (value: unknown): ShellProps => {
	if (!isRecord(value)) {
		return {
			absoluteConfigState: null,
			eslintCatalog: null,
			packageJsonState: null,
			panel: DEFAULT_PANEL,
			prettierState: null,
			tsconfigState: null
		};
	}

	return {
		absoluteConfigState: isAbsoluteState(value.absoluteConfigState)
			? value.absoluteConfigState
			: null,
		eslintCatalog: isCatalog(value.eslintCatalog)
			? value.eslintCatalog
			: null,
		packageJsonState: isPackageState(value.packageJsonState)
			? value.packageJsonState
			: null,
		panel: isConfigPanelId(value.panel) ? value.panel : DEFAULT_PANEL,
		prettierState: isPrettierState(value.prettierState)
			? value.prettierState
			: null,
		tsconfigState: isTsState(value.tsconfigState)
			? value.tsconfigState
			: null
	};
};

hydrateRoot(
	document,
	createElement(ConfigShell, readShellProps(window.__INITIAL_PROPS__))
);
