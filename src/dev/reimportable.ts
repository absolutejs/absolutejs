/* Which edited files the browser should re-import on a hot update.
 *
 * Only script modules can be re-imported: the dev module server serves
 * `/@src/x.ts` as JavaScript, but a font, a license or a README under a
 * source folder is not a module, and asking the browser to `import()` one
 * fails ("Failed to load module script: ... MIME type"). A data file a
 * script imports (JSON) updates through the scripts that import it. */

const SCRIPT_MODULE = /\.(?:[cm]?[jt]sx?)$/u;

/** Whether `file` is a script module the browser can import. */
export const isScriptModule = (file: string) => SCRIPT_MODULE.test(file);

/** The edited files to re-import: scripts as they are, other files by the
 *  scripts that import them, files nothing imports not at all. */
export const reimportableFiles = (
	files: string[],
	importersOf: (file: string) => string[],
	exists: (file: string) => boolean
) => [
	...new Set(
		files.flatMap((file) => {
			if (isScriptModule(file)) return exists(file) ? [file] : [];

			return importersOf(file).filter(
				(importer) => isScriptModule(importer) && exists(importer)
			);
		})
	)
];
