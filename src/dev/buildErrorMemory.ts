import { resolve } from 'node:path';
import type { BuildPassError } from '../../types/build';

type RemembersBuildErrors = { lastBuildErrors?: BuildPassError[] };

/**
 * Forget the stored build errors reported against files that now compile.
 *
 * A full build that fails stores its errors so a browser that connects
 * later (a reload, a second tab) is shown the overlay too. A fix often
 * arrives through a fast path instead (one React component), which never
 * runs the full build that would clear them, so without this every reload
 * kept showing an error for code that compiles. Errors with no file, or
 * for files not in `compiledFiles`, stay until a full build clears them.
 */
export const forgetBuildErrorsFor = (
	state: RemembersBuildErrors,
	compiledFiles: Iterable<string>
) => {
	if (!state.lastBuildErrors) return;
	const compiled = new Set([...compiledFiles].map((file) => resolve(file)));
	const remaining = state.lastBuildErrors.filter(
		(error) =>
			error.file === undefined || !compiled.has(resolve(error.file))
	);
	state.lastBuildErrors = remaining.length > 0 ? remaining : undefined;
};
