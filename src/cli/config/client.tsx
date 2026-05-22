import { createElement } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { ConfigShell } from './page/ConfigShell';
import { DEFAULT_PANEL, isConfigPanelId } from './panels';
import { isRecord } from './guards';

const readPanel = (value: unknown) =>
	isRecord(value) && isConfigPanelId(value.panel)
		? value.panel
		: DEFAULT_PANEL;

hydrateRoot(
	document,
	createElement(ConfigShell, { panel: readPanel(window.__INITIAL_PROPS__) })
);
