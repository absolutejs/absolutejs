import type { ToolAdapter } from '../../../types/tool';
import { runTool } from '../cache';

export const eslintAdapter: ToolAdapter = {
	configFiles: ['eslint.config.mjs'],
	fileGlobs: [
		'**/*.ts',
		'**/*.tsx',
		'**/*.js',
		'**/*.mjs',
		'**/*.json',
		'**/*.svelte'
	],
	ignorePatterns: [
		'**/node_modules/**',
		'**/dist/**',
		'**/compiled/**',
		'**/build/**',
		'**/.absolutejs/**'
	],
	name: 'eslint',
	buildCommand: (files, args) => ['bun', 'eslint', ...args, ...files]
};

export const eslint = async (args: string[]) => {
	await runTool(eslintAdapter, args);
};
