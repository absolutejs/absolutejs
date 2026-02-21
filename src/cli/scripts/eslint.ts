import type { ToolAdapter } from '../../../types/tool';
import { runTool } from '../cache';

export const eslintAdapter: ToolAdapter = {
	name: 'eslint',
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
	configFiles: ['eslint.config.mjs'],
	buildCommand: (files, args) => ['bun', 'eslint', ...args, ...files]
};

export const eslint = async (args: string[]) => {
	await runTool(eslintAdapter, args);
};
