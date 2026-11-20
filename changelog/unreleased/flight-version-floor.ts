import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: "A React Server Components build produces the Flight payload a browser runs, so the Flight runtime's version is part of what ships. The build checked only that react-server-dom-webpack was installed, not which version: 19.0.0–19.2.0 carry the Flight RCE CVE-2025-55182, and 19.2.1–19.2.2 the follow-up DoS and source-exposure fixes, so a build against any of them shipped a known vulnerability while the peer range `^19.2.0` allowed it. The build now refuses a Flight runtime below 19.2.3, naming the CVE and the single command that upgrades react, react-dom and the runtime together, and also refuses a version that does not equal react's own, since the renderer and the Flight runtime are released together and are not compatible across versions. Two deliberate narrownesses: a patched 19.0.x or 19.1.x line carries the fixes too but its patch numbers are recorded nowhere, so only 19.2.3 and above are recognised and the error says so; and a version that cannot be read — a workspace link — warns instead of failing a build the installed code may be fine for. Nothing changes for an app without a reactServerComponentsDirectory.",
	kind: 'security',
	summary:
		'A React Server Components build refuses a vulnerable Flight runtime'
};
