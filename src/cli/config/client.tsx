import { createElement } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { ConfigShell } from './page/ConfigShell';
import { DEFAULT_PANEL, isConfigPanelId } from './panels';
import { isRecord } from './guards';
import type { ConfigPanelId } from '../../../types/config';
import type { RuleCatalog } from '../../../types/eslintConfig';

type ShellProps = {
	eslintCatalog: RuleCatalog | null;
	panel: ConfigPanelId;
};

const isCatalog = (value: unknown): value is RuleCatalog =>
	isRecord(value) && Array.isArray(value.meta) && Array.isArray(value.blocks);

const readShellProps = (value: unknown): ShellProps => {
	if (!isRecord(value)) return { eslintCatalog: null, panel: DEFAULT_PANEL };

	return {
		eslintCatalog: isCatalog(value.eslintCatalog)
			? value.eslintCatalog
			: null,
		panel: isConfigPanelId(value.panel) ? value.panel : DEFAULT_PANEL
	};
};

hydrateRoot(
	document,
	createElement(ConfigShell, readShellProps(window.__INITIAL_PROPS__))
);
