import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: 'In GitHub Actions, every type error appeared twice. A checker that notices it is running there prints a `::error file=…` workflow command beside each diagnostic — bun check does — so one error reached the log once in the shape this command renders and once as an annotation it never saw. The second copy also bypassed the de-duplication that decides what to print, so an error two checkers both found could be annotated by the one whose copy was dropped. Checkers now run without that signal, because this command owns what reaches the log. The trade-off is that bun check no longer annotates lines inline on a pull request; the diagnostics themselves are unchanged, and nothing about a local run changes.',
	kind: 'fixed',
	summary: 'A type error is reported once in GitHub Actions'
};
