import { existsSync, readFileSync } from 'node:fs';
import { relative } from 'node:path';
import { applyAbsoluteConfigEdit } from '../config/absolute/editAbsoluteConfig';
import { resolveProject } from '../generate/context';
import { frameworkDependencyNames } from '../add/dependencies';
import { isFrameworkKey, type FrameworkKey } from '../generate/frameworkKey';
import { frameworks } from '../generate/frameworks';
import { findRoutingFile } from '../generate/routeWiring';
import { colors } from '../tuiPrimitives';

const write = (text: string) => process.stdout.write(`${text}\n`);

const fail = (message: string) => {
	process.stdout.write(`${colors.red}${message}${colors.reset}\n`);
	process.exitCode = 1;
};

const HANDLER_NAME: Record<FrameworkKey, string> = {
	angular: 'handleAngularPageRequest',
	html: 'handleHTMLPageRequest',
	htmx: 'handleHTMXPageRequest',
	react: 'handleReactPageRequest',
	svelte: 'handleSveltePageRequest',
	vue: 'handleVuePageRequest'
};

// Files that still call the framework's page handler, so the user knows what to
// clean up (remove never edits route code — too easy to break a customized chain).
const referencingFiles = (serverEntry: string, handler: string) => {
	const candidates = [findRoutingFile(serverEntry), serverEntry];
	const seen = new Set<string>();

	return candidates.filter((file): file is string => {
		if (file === null || seen.has(file) || !existsSync(file)) return false;
		seen.add(file);

		return readFileSync(file, 'utf-8').includes(handler);
	});
};

export const runRemove = async (args: string[]) => {
	const [framework] = args.filter((arg) => !arg.startsWith('--'));
	const prune = args.includes('--prune');
	if (!framework || !isFrameworkKey(framework)) {
		fail(
			'Usage: absolute remove <react|svelte|vue|angular|html|htmx> [--prune]'
		);

		return;
	}

	const cwd = process.cwd();
	let project;
	try {
		project = await resolveProject(cwd);
	} catch (error) {
		fail(error instanceof Error ? error.message : String(error));

		return;
	}
	if (!project.configPath) {
		fail('No absolute.config.ts found in this project.');

		return;
	}
	const frameworkDir = project.frameworkDirs[framework];
	if (!frameworkDir) {
		write(
			`${colors.yellow}!${colors.reset} ${frameworks[framework].label} is not configured — nothing to remove.`
		);

		return;
	}

	const edit = applyAbsoluteConfigEdit(project.configPath, {
		name: `${framework}Directory`,
		remove: true
	});
	if (!edit.ok) {
		fail(`Could not update absolute.config.ts: ${edit.message}`);

		return;
	}

	write(
		`${colors.green}✓${colors.reset} Removed ${framework}Directory from absolute.config.ts\n`
	);
	write(
		`  ${colors.dim}Kept${colors.reset}  ${relative(cwd, frameworkDir)} — delete its source manually if no longer needed.`
	);

	const refs = referencingFiles(project.serverEntry, HANDLER_NAME[framework]);
	for (const file of refs) {
		write(
			`  ${colors.yellow}Still references${colors.reset}  ${relative(cwd, file)} (calls ${HANDLER_NAME[framework]})`
		);
	}

	const deps = frameworkDependencyNames(framework);
	if (prune && deps.length > 0) {
		Bun.spawnSync(['bun', 'remove', ...deps], {
			cwd,
			stderr: 'inherit',
			stdout: 'inherit'
		});
		write(
			`  ${colors.dim}Pruned${colors.reset}  ${deps.length} package(s).`
		);
	} else if (deps.length > 0) {
		write(
			`\n  Run \`absolute remove ${framework} --prune\` to also uninstall: ${deps.join(', ')}`
		);
	}
};
