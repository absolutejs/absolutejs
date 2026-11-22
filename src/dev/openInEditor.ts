/* Open a file at a line in the person's editor, from a click in the dev
 * error overlay.
 *
 * The overlay already knew the file, line and column — it printed them as
 * plain text, and the only thing to do with them was read them, switch
 * windows and navigate by hand. Every other dev server in this category
 * makes that one click.
 *
 * This endpoint spawns a process with a path from an HTTP request, so the
 * rules are tighter than the feature deserves on its own:
 *
 *   - It exists only on the dev server. The HMR plugin that mounts it is
 *     not installed in production.
 *   - The path must resolve inside the project root. `validateSafePath`
 *     is the same guard the image endpoint uses.
 *   - The file must already exist, so the editor is never asked to create
 *     one.
 *   - The editor command comes from the environment, never from the
 *     request, and the file is passed as an argv entry with no shell, so
 *     nothing in the path can be interpreted as a command.
 *
 * Without `$EDITOR` set, this reports that rather than guessing at an
 * installed editor: launching the wrong application on someone's machine
 * because a guess matched is worse than telling them which variable to
 * set. */

import { existsSync } from 'node:fs';
import { basename } from 'node:path';
import { env } from 'node:process';
import { validateSafePath } from '../utils/validateSafePath';

/** The editor to launch. `ABSOLUTE_EDITOR` wins so this can be set for
 *  one project without disturbing `$EDITOR`, which also drives git. */
export const editorCommand = () =>
	env.ABSOLUTE_EDITOR ?? env.LAUNCH_EDITOR ?? env.EDITOR ?? null;

/* Argument shapes, which differ per editor and are the whole reason this
 * is a table rather than one string template. A `file:line:column` passed
 * to an editor that wants `--line` opens a file with a colon in its name,
 * or nothing at all. */
const VSCODE_FAMILY = new Set([
	'code',
	'code-insiders',
	'codium',
	'cursor',
	'positron',
	'windsurf'
]);
const JETBRAINS_FAMILY = new Set([
	'clion',
	'idea',
	'phpstorm',
	'pycharm',
	'rider',
	'rubymine',
	'webstorm'
]);
const SUBLIME_FAMILY = new Set(['subl', 'sublime_text']);
const VIM_FAMILY = new Set(['nvim', 'vi', 'vim']);

/** How to tell `command` to open `file` at `line`:`column`. */
export const editorArgs = (
	command: string,
	file: string,
	line: number | undefined,
	column: number | undefined
) => {
	/* Matched on the basename so an absolute path to the binary, or a
	 * wrapper like `/usr/local/bin/code`, still resolves. */
	const name = basename(command)
		.toLowerCase()
		.replace(/\.(cmd|exe)$/u, '');
	const position = [file, line, column].filter((part) => part !== undefined);

	if (VSCODE_FAMILY.has(name)) return ['-g', position.join(':')];
	if (SUBLIME_FAMILY.has(name)) return [position.join(':')];
	if (JETBRAINS_FAMILY.has(name))
		return line === undefined
			? [file]
			: [
					'--line',
					String(line),
					...(column === undefined
						? []
						: ['--column', String(column)]),
					file
				];
	if (VIM_FAMILY.has(name))
		return line === undefined ? [file] : [`+${line}`, file];
	if (name === 'emacs' || name === 'emacsclient')
		return line === undefined ? [file] : [`+${line}`, file];

	/* An editor this does not know gets the path alone, which every
	 * editor understands, rather than a guess that might open garbage. */
	return [file];
};

export type OpenInEditorRequest = {
	column?: number;
	file: string;
	line?: number;
	projectRoot: string;
};

export type OpenInEditorResult =
	| { ok: true; command: string }
	| { ok: false; reason: string; status: number };

const BAD_REQUEST = 400;
const NOT_CONFIGURED = 501;
const SERVER_ERROR = 500;

/** Launch the editor. Returns a result rather than throwing, so the
 *  endpoint can answer with something the overlay can show. */
export const openInEditor = ({
	column,
	file,
	line,
	projectRoot
}: OpenInEditorRequest): OpenInEditorResult => {
	/* Path first, editor second. The path check is the security boundary,
	 * so it must not be reachable only when an editor happens to be
	 * configured — and a traversal attempt answered "no editor
	 * configured" tells the caller the wrong thing about why it failed. */
	let resolved: string;
	try {
		resolved = validateSafePath(file, projectRoot);
	} catch {
		return {
			ok: false,
			reason: `Refusing to open ${file}: it resolves outside the project.`,
			status: BAD_REQUEST
		};
	}
	if (!existsSync(resolved))
		return {
			ok: false,
			reason: `No such file: ${resolved}`,
			status: BAD_REQUEST
		};

	const command = editorCommand();
	if (command === null)
		return {
			ok: false,
			reason: 'No editor configured. Set $EDITOR, $LAUNCH_EDITOR or $ABSOLUTE_EDITOR to the command that opens your editor — `code`, `cursor`, `subl`, `webstorm`, `nvim`.',
			status: NOT_CONFIGURED
		};

	try {
		/* argv, never a shell: nothing in the path can become a command.
		 * Detached and with its streams ignored, so a terminal editor
		 * does not inherit the dev server's stdio and the server does not
		 * wait for the editor to exit. */
		Bun.spawn([command, ...editorArgs(command, resolved, line, column)], {
			stderr: 'ignore',
			stdin: 'ignore',
			stdout: 'ignore'
		}).unref();
	} catch (error) {
		return {
			ok: false,
			reason: `Could not run \`${command}\`: ${error instanceof Error ? error.message : String(error)}`,
			status: SERVER_ERROR
		};
	}

	return { command, ok: true };
};
