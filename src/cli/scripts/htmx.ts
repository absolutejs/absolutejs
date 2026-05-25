import { resolveProject } from '../generate/context';
import {
	VENDORED_HTMX_VERSION,
	detectHtmxVersion,
	fetchHtmx,
	installedHtmxVersion,
	writeHtmx
} from '../htmx/install';
import { colors } from '../tuiPrimitives';

const write = (text: string) => process.stdout.write(`${text}\n`);

const fail = (message: string) => {
	process.stdout.write(`${colors.red}${message}${colors.reset}\n`);
	process.exitCode = 1;
};

// `absolute htmx`             — report the installed + vendored versions
// `absolute htmx <version>`   — fetch that version (or "latest") and self-host it
export const runHtmx = async (args: string[]) => {
	const target = args.find((arg) => !arg.startsWith('--'));
	const cwd = process.cwd();
	let project;
	try {
		project = await resolveProject(cwd);
	} catch (error) {
		fail(error instanceof Error ? error.message : String(error));

		return;
	}

	const htmxDir = project.frameworkDirs.htmx;
	if (!htmxDir) {
		fail("htmx isn't configured. Run `absolute add htmx` first.");

		return;
	}

	if (target === undefined) {
		const current = installedHtmxVersion(htmxDir);
		write(
			`  ${colors.dim}installed${colors.reset}  ${current ?? `${colors.yellow}not installed${colors.reset}`}`
		);
		write(
			`  ${colors.dim}vendored${colors.reset}   ${VENDORED_HTMX_VERSION}`
		);
		write(
			`\n  Upgrade with \`absolute htmx <version>\` (e.g. \`absolute htmx latest\`).`
		);

		return;
	}

	try {
		const content = await fetchHtmx(target);
		const file = writeHtmx(htmxDir, content);
		const version = detectHtmxVersion(content) ?? target;
		write(
			`${colors.green}✓${colors.reset} Installed htmx ${version} → ${file}`
		);
	} catch (error) {
		fail(error instanceof Error ? error.message : String(error));
	}
};
