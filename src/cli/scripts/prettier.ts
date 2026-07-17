import type { ToolAdapter } from '../../../types/tool';
import { runTool } from '../cache';

const FLAG_VALUE_FLAGS = new Set([
	'--cache-location',
	'--config',
	'--config-precedence',
	'--cursor-offset',
	'--embedded-language-formatting',
	'--end-of-line',
	'--ignore-path',
	'--insert-pragma',
	'--log-level',
	'--parser',
	'--plugin',
	'--print-width',
	'--prose-wrap',
	'--quote-props',
	'--range-end',
	'--range-start',
	'--tab-width',
	'--trailing-comma',
	'--use-tabs'
]);

export const prettierAdapter: ToolAdapter = {
	configFiles: ['.prettierrc.json'],
	fileGlobs: [
		'**/*.ts',
		'**/*.tsx',
		'**/*.js',
		'**/*.mjs',
		'**/*.json',
		'**/*.svelte',
		'**/*.vue',
		'**/*.html',
		'**/*.css'
	],
	ignorePatterns: [
		'**/node_modules/**',
		'**/dist/**',
		'**/build/**',
		'**/.absolutejs/**',
		'**/generated/**',
		'**/compiled/**',
		'**/*.min.js'
	],
	name: 'prettier',
	buildCommand: (files, args) => ['bun', 'prettier', ...args, ...files]
};

export const buildTargetedPrettierCommand = (args: string[]) => [
	'bun',
	'prettier',
	...args
];

export const hasPrettierTarget = (args: string[]) => {
	for (let index = 0; index < args.length; index++) {
		const argument = args[index];
		if (argument === undefined) continue;
		if (argument === '--') return index + 1 < args.length;
		if (!argument.startsWith('-')) return true;
		if (!argument.includes('=') && FLAG_VALUE_FLAGS.has(argument)) index++;
	}

	return false;
};

export const prettier = async (args: string[]) => {
	if (hasPrettierTarget(args)) {
		const child = Bun.spawn(buildTargetedPrettierCommand(args), {
			stderr: 'inherit',
			stdout: 'inherit'
		});
		if ((await child.exited) !== 0) process.exitCode = 1;

		return;
	}
	await runTool(prettierAdapter, args);
};
