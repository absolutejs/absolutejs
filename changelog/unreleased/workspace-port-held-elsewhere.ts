import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: "`absolute workspace dev` warned that another program held a service's port, then started the service anyway and probed the port for readiness. The other program answered, so the service showed \"ready\" while every request reached someone else's server, and the service itself exited without saying why. A service whose port another program still holds now refuses to start, naming that program: stop it, or give the service another port.",
	kind: 'fixed',
	summary: "A workspace service never shows ready on a port another program holds"
};
