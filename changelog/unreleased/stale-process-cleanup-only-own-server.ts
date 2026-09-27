import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: "`absolute start`, `compile`, the config server and `workspace` cleared their port by killing every process listening on it, including unrelated services and other projects' servers (a PostgreSQL, another app, a control plane). They now stop only a leftover AbsoluteJS server started from this project directory, and report anything else on the port as left running.",
	kind: 'fixed',
	summary:
		'Starting a server no longer kills unrelated processes that hold its port'
};
