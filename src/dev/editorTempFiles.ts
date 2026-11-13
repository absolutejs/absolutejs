/* Files editors and tools write for a moment while saving: they write the
 * new content to a temp sibling and rename it over the real file, or keep
 * a swap/lock file beside it. Treating one as a source change either does
 * nothing or, worse, makes the dev server think a new module appeared and
 * rebootstrap the page (losing its state). Every dev watcher skips them;
 * the real file's own change event (or the atomic-rename recovery scan)
 * still drives HMR. Matched on the basename only. */
const EDITOR_TEMP_FILE_PATTERNS: readonly RegExp[] = [
	// Generic temp files, and Prettier/IDE `file.ts.tmp.123` writes.
	/\.tmp$/,
	/\.tmp\./,
	// Backup files (Emacs, Vim `backupcopy`, many IDEs).
	/~$/,
	// Emacs lock files (`.#file.ts`) and autosaves (`#file.ts#`).
	/^\.#/,
	/^#.*#$/,
	// GNU `sed -i` temp file (`sedAbC123`).
	/^sed[A-Za-z0-9]{6,}$/,
	// BSD/macOS `sed -i` temp file (`.!12345!file.ts`).
	/^\.![0-9]+!/,
	// Vim's write-permission probe and its swap files (`.file.ts.swp`).
	/^4913$/,
	/^\..+\.sw[a-px]$/,
	/\.sw[opx]$/,
	// JetBrains safe-write temp and backup files.
	/___jb_(?:tmp|old|bak)___$/,
	// Chrome/Edge File System Access API swap file.
	/\.crswap$/,
	// Kate swap files and GNOME (gedit) atomic-write temp files.
	/\.kate-swp$/,
	/^\.goutputstream-/
];

const basenameOf = (path: string) => {
	const normalized = path.replace(/\\/g, '/');

	return normalized.slice(normalized.lastIndexOf('/') + 1);
};

/** True when `path` (a filename or a path) names an editor/tool temp,
 *  swap, lock or backup file rather than a real source file. */
export const isEditorTempFile = (path: string) => {
	const name = basenameOf(path);
	if (name === '') return false;

	return EDITOR_TEMP_FILE_PATTERNS.some((pattern) => pattern.test(name));
};
