export type ConfigPanelId = 'eslint' | 'tsconfig' | 'prettier';

export type ConfigPanelStatus = 'ready' | 'soon';

export type ConfigPanelMeta = {
	/** One-line description shown under the panel name in the sidebar. */
	blurb: string;
	id: ConfigPanelId;
	label: string;
	/** `'ready'` panels are interactive; `'soon'` panels render a placeholder. */
	status: ConfigPanelStatus;
};
