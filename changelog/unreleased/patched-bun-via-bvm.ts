import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: "`absolute dev` and `absolute bun-patch` now install AbsoluteJS's patched Bun with bvm (`@absolutejs/bvm`, a new dependency), which checks the release's checksum list against the AbsoluteJS release key's Ed25519 signature before anything runs. The CLI no longer downloads and unzips the build itself or pins a SHA-256 per platform, so a new patched build no longer needs a framework release. A patched build installed by an earlier release in `~/.absolutejs/bun` moves onto bvm's copy on the next `absolute dev`. bvm has builds for Linux, macOS and Windows on x64 and arm64; FreeBSD and Android no longer get the offer.",
	kind: 'changed',
	summary:
		'The patched Bun for React Fast Refresh is installed and verified by bvm'
};
