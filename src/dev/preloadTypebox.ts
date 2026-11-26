import { dirname } from 'node:path';

/* Elysia 2 loads TypeBox lazily and SYNCHRONOUSLY: the first `t.String()`
 * anywhere calls `require('typebox/type')`. Bun refuses to `require()` an
 * ES module that an `import` is still loading ("require() async module
 * ... is unsupported"), and the dev bootstrap creates exactly that
 * overlap: it imports the framework runtime — whose graph reaches TypeBox
 * — in parallel with the app's server entry. An app whose own imports
 * call `t.*` at module scope (an auth plugin's schemas, for one) then
 * crashed at startup whenever its evaluation landed inside the runtime's
 * load. Measured on the example app: 5 of 12 boots.
 *
 * Loading the module to completion BEFORE the parallel import is issued
 * closes the window: an evaluated module can always be required.
 *
 * Resolved from Elysia's own location, because that is where Elysia's
 * `require` resolves it; a project with two copies of TypeBox would
 * otherwise have the wrong one preloaded. Nothing here may fail the boot:
 * without Elysia or TypeBox there is no race to close. */
export const preloadTypebox = async (from: string) => {
	try {
		const elysiaEntry = Bun.resolveSync('elysia', from);
		const typeEntry = Bun.resolveSync('typebox/type', dirname(elysiaEntry));
		await import(typeEntry);

		return true;
	} catch {
		return false;
	}
};
