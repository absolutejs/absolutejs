import { createElement } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { ConfigShell } from './page/ConfigShell';
import { DEFAULT_PANEL, isConfigPanelId } from './panels';
import { isRecord } from './guards';
import type { ConfigPanelId } from '../../../types/config';
import type { RuleCatalog } from '../../../types/eslintConfig';
import type { TsConfigState } from '../../../types/tsconfig';

type ShellProps = {
	eslintCatalog: RuleCatalog | null;
	panel: ConfigPanelId;
	tsconfigState: TsConfigState | null;
};

const isCatalog = (value: unknown): value is RuleCatalog =>
	isRecord(value) && Array.isArray(value.meta) && Array.isArray(value.blocks);

const isTsState = (value: unknown): value is TsConfigState =>
	isRecord(value) && Array.isArray(value.options);

const readShellProps = (value: unknown): ShellProps => {
	if (!isRecord(value)) {
		return {
			eslintCatalog: null,
			panel: DEFAULT_PANEL,
			tsconfigState: null
		};
	}

	return {
		eslintCatalog: isCatalog(value.eslintCatalog)
			? value.eslintCatalog
			: null,
		panel: isConfigPanelId(value.panel) ? value.panel : DEFAULT_PANEL,
		tsconfigState: isTsState(value.tsconfigState)
			? value.tsconfigState
			: null
	};
};

hydrateRoot(
	document,
	createElement(ConfigShell, readShellProps(window.__INITIAL_PROPS__))
);
