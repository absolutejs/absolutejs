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

/* Type guard for client messages */
export function isValidHMRClientMessage(data: unknown): data is HMRClientMessage {
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
