/* `absolute fmt` formats with Bun's own formatter (`bun fmt`, Bun 1.4.4+). It
 * reads the project's existing Prettier configuration (.prettierrc*, overrides,
 * .prettierignore, .editorconfig) and matches Prettier 3.9's output, Svelte
 * included, in a fraction of the time, so it needs no cache. `absolute
 * prettier` stays for projects whose Prettier plugins bun fmt doesn't support. */
const MINIMUM_BUN = '1.4.4';

const bunSupportsFmt = (version: string) =>
	Bun.semver.order(version.split(/[-+]/)[0] ?? version, MINIMUM_BUN) >= 0;

export const fmt = async (args: string[]) => {
	if (!bunSupportsFmt(Bun.version)) {
		console.error(
			`absolute fmt needs Bun ${MINIMUM_BUN} or newer for \`bun fmt\`; this is Bun ${Bun.version}. Upgrade Bun, or run \`absolute prettier\`.`
		);
		process.exitCode = 1;

		return;
	}
	const child = Bun.spawn([process.execPath, 'fmt', ...args], {
		stderr: 'inherit',
		stdin: 'inherit',
		stdout: 'inherit'
	});
	process.exitCode = await child.exited;
};
