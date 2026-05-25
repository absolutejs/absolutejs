import { relative } from 'node:path';
import { resolveProject, selectFramework } from '../generate/context';
import { generateApi } from '../generate/generateApi';
import { generateComponent } from '../generate/generateComponent';
import { generatePage } from '../generate/generatePage';
import { isValidName } from '../generate/naming';
import type { GenerateOutcome } from '../generate/outcome';
import { colors } from '../tuiPrimitives';

const SUBCOMMANDS = new Set(['api', 'component', 'page']);

const write = (text: string) => process.stdout.write(`${text}\n`);

const fail = (message: string) => {
	process.stdout.write(`${colors.red}${message}${colors.reset}\n`);
	process.exitCode = 1;
};

// Positional args are everything that isn't a recognized flag or a flag's value,
// so `generate page dashboard --framework react` yields ['page', 'dashboard'].
const readArgs = (args: string[]) => {
	const consumed = new Set<number>();
	const valueFlags = ['--config', '--framework'];
	for (const flag of valueFlags) {
		const idx = args.indexOf(flag);
		if (idx < 0) continue;
		consumed.add(idx);
		consumed.add(idx + 1);
	}
	const positionals = args.filter(
		(value, idx) => !consumed.has(idx) && !value.startsWith('--')
	);
	const flagValue = (flag: string) => {
		const idx = args.indexOf(flag);

		return idx >= 0 ? args[idx + 1] : undefined;
	};

	return {
		config: flagValue('--config'),
		framework: flagValue('--framework'),
		name: positionals[1],
		subcommand: positionals[0]
	};
};

const printList = (label: string, paths: string[], cwd: string) => {
	if (paths.length === 0) return;
	write(`  ${colors.dim}${label}${colors.reset}`);
	for (const path of paths) write(`    ${relative(cwd, path)}`);
};

const printSummary = (title: string, outcome: GenerateOutcome, cwd: string) => {
	for (const note of outcome.notes) {
		write(`${colors.yellow}!${colors.reset} ${note}`);
	}
	if (outcome.created.length === 0 && outcome.updated.length === 0) return;

	write(`${colors.green}✓${colors.reset} Generated ${title}\n`);
	printList('Created', outcome.created, cwd);
	printList('Updated', outcome.updated, cwd);
	if (outcome.route)
		write(`\n  ${colors.dim}Route${colors.reset}  ${outcome.route}`);
	if (outcome.manual) {
		write(
			`\n  ${colors.yellow}Couldn't auto-wire the route${colors.reset} (${outcome.manual.reason}). Add manually:\n`
		);
		for (const line of outcome.manual.snippet.split('\n'))
			write(`    ${line}`);
	}
	write(
		`\n  ${colors.dim}Next${colors.reset}  run \`absolute prettier --write\` to format edits, then \`absolute dev\``
	);
};

export const runGenerate = async (args: string[]) => {
	const { config, framework, name, subcommand } = readArgs(args);
	if (!subcommand || !SUBCOMMANDS.has(subcommand)) {
		fail(
			'Usage: absolute generate <page|api|component> <name> [--framework <name>]'
		);

		return;
	}
	if (!isValidName(name)) {
		fail(
			`Provide a name, e.g. \`absolute generate ${subcommand} dashboard\`.`
		);

		return;
	}

	const cwd = process.cwd();
	let project;
	try {
		project = await resolveProject(cwd, config);
	} catch (error) {
		fail(error instanceof Error ? error.message : String(error));

		return;
	}

	if (subcommand === 'api') {
		printSummary(`api ${name}`, generateApi(project, name), cwd);

		return;
	}

	const selected = selectFramework(project, framework);
	if (!selected.ok) {
		fail(selected.message);

		return;
	}
	const outcome =
		subcommand === 'page'
			? generatePage(project, selected.framework, name)
			: generateComponent(project, selected.framework, name);
	printSummary(`${subcommand} ${name} (${selected.framework})`, outcome, cwd);
};
