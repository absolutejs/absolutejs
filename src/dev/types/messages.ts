/* HMR message types for client-server communication */

/* Client-to-server message types */
export type PingMessage = {
	type: 'ping';
};

export type ReadyMessage = {
	type: 'ready';
	framework?: string | null;
};

export type RequestRebuildMessage = {
	type: 'request-rebuild';
};

export type HydrationErrorMessage = {
	type: 'hydration-error';
	data?: {
		componentName?: string;
		componentPath?: string;
		error?: string;
	};
};

export type HMRClientMessage =
	| PingMessage
	| ReadyMessage
	| RequestRebuildMessage
	| HydrationErrorMessage;

/* Server-to-client message types */
export type ManifestMessage = {
  type: 'manifest';
  data: {
    manifest: Record<string, string>;
    serverVersions?: Record<string, number>;
  };
  timestamp: number;
};

export type RebuildStartMessage = {
  type: 'rebuild-start';
  data: {
    affectedFrameworks: string[];
  };
  timestamp: number;
};

export type RebuildCompleteMessage = {
  type: 'rebuild-complete';
  data: {
    affectedFrameworks: string[];
    manifest: Record<string, string>;
  };
  timestamp: number;
};

export type FrameworkUpdateMessage = {
  type: 'framework-update';
  data: {
    framework: string;
    manifest?: Record<string, string>;
  };
  timestamp: number;
};

export type ModuleUpdateMessage = {
  type: 'module-update';
  data: {
    framework: string;
    manifest?: Record<string, string>;
    modules?: Array<{
      sourceFile: string;
      moduleKeys: string[];
      modulePaths: Record<string, string>;
      componentType?: 'client' | 'server';
      version?: number;
    }>;
    moduleVersions?: Record<string, number>;
    serverVersions?: Record<string, number>;
  };
  timestamp: number;
};

export type ReactUpdateMessage = {
  type: 'react-update';
  data: {
    sourceFile: string;
    html?: string;
    manifest?: Record<string, string>;
  };
  timestamp: number;
};

export type HTMLUpdateMessage = {
  type: 'html-update';
  data: {
    sourceFile: string;
    html?: string;
  };
  timestamp: number;
};

export type HTMXUpdateMessage = {
  type: 'htmx-update';
  data: {
    sourceFile: string;
    html?: string;
  };
  timestamp: number;
};

export type SvelteUpdateMessage = {
  type: 'svelte-update';
  data: {
    sourceFile: string;
    html?: string;
    manifest?: Record<string, string>;
  };
  timestamp: number;
};

export type VueUpdateMessage = {
  type: 'vue-update';
  data: {
    sourceFile: string;
    html?: string;
    manifest?: Record<string, string>;
    // Native Vue HMR fields
    hmrId?: string;
    changeType?: 'style-only' | 'template-only' | 'script' | 'full';
    componentPath?: string;
    cssUrl?: string;
    cssBaseName?: string;
    updateType?: 'css-only' | 'full';
  };
  timestamp: number;
};

export type RebuildErrorMessage = {
  type: 'rebuild-error';
  data: {
    affectedFrameworks: string[];
    error: string;
  };
  timestamp: number;
};

export type PongMessage = {
  type: 'pong';
  timestamp: number;
};

export type ConnectedMessage = {
  type: 'connected';
  message?: string;
  timestamp: number;
};

export type HMRServerMessage =
  | ManifestMessage
  | RebuildStartMessage
  | RebuildCompleteMessage
  | FrameworkUpdateMessage
  | ModuleUpdateMessage
  | ReactUpdateMessage
  | HTMLUpdateMessage
  | HTMXUpdateMessage
  | SvelteUpdateMessage
  | VueUpdateMessage
  | RebuildErrorMessage
  | PongMessage
  | ConnectedMessage;

/* Type guard for client messages */
export function isValidHMRClientMessage(
	data: unknown
): data is HMRClientMessage {
	if (!data || typeof data !== 'object') {
		return false;
	}

	const message = data as Record<string, unknown>;

	if (!('type' in message) || typeof message.type !== 'string') {
		return false;
	}

	switch (message.type) {
		case 'ping':
			return true;
		case 'ready':
			return true;
		case 'request-rebuild':
			return true;
		case 'hydration-error':
			return true;
		default:
			return false;
	}
}
