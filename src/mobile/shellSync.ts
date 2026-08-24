import { installSyncClientRuntimeTransport } from '@absolutejs/sync/client/runtime';
import type { AbsoluteMobileShellAuthRuntime } from './shellBootstrap';

export const installAbsoluteMobileShellSync = (
	auth: AbsoluteMobileShellAuthRuntime
) => {
	installSyncClientRuntimeTransport({ socketTicket: auth.socketTicket });
};
