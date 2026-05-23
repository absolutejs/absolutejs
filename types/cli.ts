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

export type InstanceRecord = {
	command: string[];
	configPath: string | null;
	controllerPid: number;
	cwd: string;
	frameworks: string[];
	host: string;
	https: boolean;
	logFile: string | null;
	name: string;
	pid: number;
	port: number | null;
	ppid: number;
	source: InstanceSource;
	startedAt: string;
};

export type InstanceSource = 'dev' | 'standalone' | 'start' | 'workspace';

export type InstanceStatus = 'ready' | 'starting' | 'stopped';

export type InteractiveHandler = {
	clearPrompt: () => void;
	dispose: () => void;
	showPrompt: () => void;
};

export type LiveInstance = InstanceRecord & {
	status: InstanceStatus;
	uptimeMs: number;
	url: string | null;
};

export type TuiColors = {
	bold: string;
	cyan: string;
	dim: string;
	green: string;
	red: string;
	reset: string;
	yellow: string;
};

export type TuiInput = {
	destroy: () => void;
	off: (event: 'data', listener: (chunk: Buffer) => void) => void;
	on: (event: 'data', listener: (chunk: Buffer) => void) => void;
	resume: () => void;
	setRawMode?: (enabled: boolean) => void;
};
