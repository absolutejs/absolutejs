/** One integration's live status in a project. `config`-kind integrations wire by
 *  toggling an absolute.config field (the runtime mounts them); `use`-kind ones are
 *  installed but the consumer adds the `.use(...)` to their own server, so we report
 *  the snippet instead of auto-editing their entry. */
export type IntegrationItem = {
	blurb: string;
	enabled: boolean;
	id: string;
	installed: boolean;
	kind: 'config' | 'use';
	label: string;
	note: string | null;
	packages: string[];
	wiringSnippet: string | null;
};

export type IntegrationsPanelState = {
	configPath: string | null;
	items: IntegrationItem[];
};

/** Result of `addIntegration` — shared by the CLI (`absolute add <plugin>`) and the
 *  config:studio panel's install button. */
export type IntegrationAddResult = {
	installed: boolean;
	item: IntegrationItem | null;
	message: string;
	ok: boolean;
	wired: boolean;
	wiringSnippet: string | null;
};
