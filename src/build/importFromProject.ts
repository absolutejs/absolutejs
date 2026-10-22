/* A package the app depends on, imported the way the app would import it.
 *
 * A bare `import(specifier)` written in the framework resolves from the
 * framework's own folder. With Bun's isolated linker -- the default for a
 * workspace -- that folder sees only the framework's own dependencies, so a
 * package only the app depends on (a workspace package, `three`, ...) failed
 * to import and the dev build crashed. Resolving from the app's folder first
 * finds what the app finds; anything that does not resolve there falls back
 * to the bare import, as before. */
export const importFromProject = (
	specifier: string,
	projectRoot = process.cwd()
) => {
	let target = specifier;
	try {
		target = Bun.resolveSync(specifier, projectRoot);
	} catch {
		// Not resolvable from the app: let the bare import decide.
	}

	return import(target);
};
