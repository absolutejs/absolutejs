import { dirname, join, relative } from 'node:path';
import { applyAbsoluteConfigEdit } from '../config/absolute/editAbsoluteConfig';
import { configuredFrameworks, resolveProject } from '../generate/context';
import { generatePage } from '../generate/generatePage';
import { isFrameworkKey } from '../generate/frameworkKey';
import { frameworks } from '../generate/frameworks';
import { installFrameworkDependencies } from '../add/dependencies';
import { addIntegration } from '../integrations/addPlugin';
import { isIntegrationId } from '../integrations/catalog';
import { scaffoldAuthFeature } from '../config/auth/scaffoldAuthFeature';
import { readVendoredHtmx, writeHtmx } from '../htmx/install';
import { colors } from '../tuiPrimitives';

const write = (text: string) => process.stdout.write(`${text}\n`);

const fail = (message: string) => {
	process.stdout.write(`${colors.red}${message}${colors.reset}\n`);
	process.exitCode = 1;
};

const printList = (label: string, paths: string[], cwd: string) => {
	if (paths.length === 0) return;
	write(`  ${colors.dim}${label}${colors.reset}`);
	for (const path of paths) write(`    ${relative(cwd, path)}`);
};

const frontendRoot = (
	project: Awaited<ReturnType<typeof resolveProject>>,
	cwd: string
) => {
	const [firstKey] = configuredFrameworks(project);
	const firstDir = firstKey ? project.frameworkDirs[firstKey] : undefined;

	return firstDir ? dirname(firstDir) : join(cwd, 'src', 'frontend');
};

const addIntegrationCli = (id: string, install: boolean) => {
	const result = addIntegration(process.cwd(), id, { install });
	if (!result.ok) {
		fail(result.message);

		return;
	}
	write(`${colors.green}✓${colors.reset} ${result.message}`);
	if (result.wiringSnippet) {
		write(`\n  ${colors.dim}Add to your server${colors.reset}:`);
		for (const line of result.wiringSnippet.split('\n'))
			write(`    ${line}`);
	}
	write(
		`\n  ${colors.dim}Next${colors.reset}  ${result.wired ? 'run `absolute dev`' : 'wire it in, then run `absolute dev`'}`
	);
};

const addAuthFeatureCli = (id: string, install: boolean) => {
	const result = scaffoldAuthFeature(process.cwd(), id, { install });
	if (!result.ok) {
		fail(result.message);

		return;
	}
	write(`${colors.green}✓${colors.reset} ${result.message}`);
	if (result.spreadSnippet) {
		write(`\n  ${colors.dim}Wire it in${colors.reset}:`);
		for (const line of result.spreadSnippet.split('\n'))
			write(`    ${line}`);
	}
	write(
		`\n  ${colors.dim}Next${colors.reset}  fill the TODO stubs, run \`absolute prettier --write\`, then \`absolute dev\``
	);
};

export const runAdd = async (args: string[]) => {
	const [framework] = args.filter((arg) => !arg.startsWith('--'));
	const noInstall = args.includes('--no-install');

	if (framework?.startsWith('auth:')) {
		addAuthFeatureCli(framework.slice('auth:'.length), !noInstall);

		return;
	}

	if (framework && isIntegrationId(framework)) {
		addIntegrationCli(framework, !noInstall);

		return;
	}

	if (!framework || !isFrameworkKey(framework)) {
		fail(
			'Usage: absolute add <react|svelte|vue|angular|html|htmx | openapi|telemetry|cors|jwt|cron> [--no-install]'
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
	if (project.frameworkDirs[framework]) {
		write(
			`${colors.yellow}!${colors.reset} ${frameworks[framework].label} is already configured — nothing to do.`
		);

		return;
	}

	const dirAbs = join(frontendRoot(project, cwd), framework);
	const dirRel = `./${relative(cwd, dirAbs).split('\\').join('/')}`;

	let depNote = 'Skipped dependency install (--no-install).';
	if (!noInstall) {
		write(
			`${colors.dim}Installing ${frameworks[framework].label} dependencies…${colors.reset}`
		);
		const { ok: succeeded, specs } = installFrameworkDependencies(
			cwd,
			framework
		);
		if (specs.length === 0) depNote = 'No extra dependencies needed.';
		else if (succeeded) depNote = `Installed ${specs.length} package(s).`;
		else depNote = 'Dependency install failed — run `bun add` manually.';
	}

	const edit = applyAbsoluteConfigEdit(project.configPath, {
		name: `${framework}Directory`,
		value: dirRel
	});
	if (!edit.ok) {
		fail(`Could not update absolute.config.ts: ${edit.message}`);

		return;
	}

	// Re-importing the just-edited config would hit Bun's module cache (stale),
	// so inject the new directory into the resolved project directly.
	const updated = {
		...project,
		frameworkDirs: { ...project.frameworkDirs, [framework]: dirAbs }
	};
	const created: string[] = [];
	if (framework === 'htmx') {
		const content = readVendoredHtmx();
		if (content) created.push(writeHtmx(dirAbs, content));
	}

	const outcome = generatePage(updated, framework, `${framework}-example`);
	write(
		`${colors.green}✓${colors.reset} Added ${frameworks[framework].label} to your project\n`
	);
	write(`  ${depNote}`);
	printList('Created', [...created, ...outcome.created], cwd);
	printList('Updated', [project.configPath, ...outcome.updated], cwd);
	if (outcome.manual) {
		write(
			`\n  ${colors.yellow}Couldn't auto-wire the route${colors.reset} (${outcome.manual.reason}). Add manually:\n`
		);
		for (const line of outcome.manual.snippet.split('\n'))
			write(`    ${line}`);
	}
	if (outcome.route)
		write(`\n  ${colors.dim}Route${colors.reset}  ${outcome.route}`);
	write(
		`\n  ${colors.dim}Next${colors.reset}  run \`absolute prettier --write\`, then \`absolute dev\``
	);
};
