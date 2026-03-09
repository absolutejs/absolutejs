import type { ToolAdapter } from '../../../types/tool';
import { runTool } from '../cache';

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
		'**/*.min.js'
	],
	name: 'prettier',
	buildCommand: (files, args) => ['bun', 'prettier', ...args, ...files]
};

export const prettier = async (args: string[]) => {
	await runTool(prettierAdapter, args);
};
