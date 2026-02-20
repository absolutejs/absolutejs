export type Action = () => void | Promise<void>;

export type Actions = {
	clear: Action;
	help: Action;
	open: Action;
	pause: Action;
	quit: Action;
	restart: Action;
	shell: (command: string) => Promise<void>;
};

export type DbScripts = {
	upCommand: string;
	downCommand: string;
};

export type InteractiveHandler = {
	clearPrompt: () => void;
	dispose: () => void;
	showPrompt: () => void;
};
