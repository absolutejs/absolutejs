// eslint.config.mjs
import { dirname } from 'path';
import { fileURLToPath } from 'url';
import pluginJs from '@eslint/js';
import stylisticTs from '@stylistic/eslint-plugin-ts';
import tsParser from '@typescript-eslint/parser';
import { defineConfig } from 'eslint/config';
import absolutePlugin from 'eslint-plugin-absolute';
import importPlugin from 'eslint-plugin-import';
import promisePlugin from 'eslint-plugin-promise';
import securityPlugin from 'eslint-plugin-security';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig([
	{
		ignores: [
			'dist/**',
			'example/build/**',
			'example/svelte/indexes/',
			'example/svelte/client/',
			'example/svelte/pages/*.js',
			'tailwind.config.ts',
			'postcss.config.ts'
		]
	},

	pluginJs.configs.recommended,

	...tseslint.configs.recommended,

	{
		files: ['**/*.{ts,tsx}'],
		languageOptions: {
			globals: {
				// TODO: These should only be applied to the src/core/build.ts file.
				BuildMessage: 'readonly',
				ResolveMessage: 'readonly'
			},
			parser: tsParser,
			parserOptions: {
				createDefaultProgram: true,
				project: './tsconfig.json',
				tsconfigRootDir: __dirname
			}
		},
		plugins: { '@stylistic/ts': stylisticTs },
		rules: {
			'@stylistic/ts/padding-line-between-statements': [
				'error',
				{ blankLine: 'always', next: 'return', prev: '*' }
			],

			'@typescript-eslint/no-unnecessary-type-assertion': 'error'
		}
	},

	{
		files: ['**/*.{js,mjs,cjs,ts,tsx,jsx}'],
		ignores: ['node_modules/**'],
		languageOptions: {
			globals: {
				...globals.browser
			}
		},
		plugins: {
			absolute: absolutePlugin,
			import: importPlugin,
			promise: promisePlugin,
			security: securityPlugin
		},
		rules: {
			'absolute/explicit-object-types': 'error',
			'absolute/localize-react-props': 'error',
			'absolute/max-depth-extended': ['error', 1],
			'absolute/max-jsxnesting': ['error', 5],
			'absolute/min-var-length': [
				'error',
				{ allowedVars: ['_', 'id', 'db', 'OK'], minLength: 3 }
			],
			'absolute/no-explicit-return-type': 'error',
			'absolute/no-useless-function': 'error',
			'absolute/sort-exports': [
				'error',
				{
					caseSensitive: true,
					natural: true,
					order: 'asc',
					variablesBeforeFunctions: true
				}
			],
			'absolute/sort-keys-fixable': [
				'error',
				{
					caseSensitive: true,
					natural: true,
					order: 'asc',
					variablesBeforeFunctions: true
				}
			],
			'arrow-body-style': ['error', 'as-needed'],
			'consistent-return': 'error',
			eqeqeq: 'error',
			'func-style': [
				'error',
				'expression',
				{ allowArrowFunctions: true }
			],
			'import/no-cycle': 'error',
			'import/no-default-export': 'error',
			'import/no-relative-packages': 'error',
			'import/no-unused-modules': ['error', { missingExports: true }],
			'import/order': ['error', { alphabetize: { order: 'asc' } }],
			'no-await-in-loop': 'error',
			'no-debugger': 'error',
			'no-duplicate-case': 'error',
			'no-duplicate-imports': 'error',
			'no-else-return': 'error',
			'no-empty-function': 'error',
			'no-empty-pattern': 'error',
			'no-empty-static-block': 'error',
			'no-fallthrough': 'error',
			'no-floating-decimal': 'error',
			'no-global-assign': 'error',
			'no-implicit-coercion': 'error',
			'no-implicit-globals': 'error',
			'no-loop-func': 'error',
			'no-magic-numbers': [
				'warn',
				{ detectObjects: false, enforceConst: true, ignore: [0, 1, 2] }
			],
			'no-misleading-character-class': 'error',
			'no-nested-ternary': 'error',
			'no-new-native-nonconstructor': 'error',
			'no-new-wrappers': 'error',
			'no-param-reassign': 'error',
			'no-restricted-imports': [
				'error',
				{
					paths: [
						{
							importNames: ['default'],
							message:
								'Import only named React exports for tree-shaking.',
							name: 'react'
						},
						{
							importNames: ['default'],
							message: 'Import only the required Bun exports.',
							name: 'bun'
						}
					]
				}
			],
			'no-return-await': 'error',
			'no-shadow': 'error',
			'no-undef': 'error',
			'no-unneeded-ternary': 'error',
			'no-unreachable': 'error',
			'no-useless-assignment': 'error',
			'no-useless-concat': 'error',
			'no-useless-return': 'error',
			'no-var': 'error',
			'prefer-arrow-callback': 'error',
			'prefer-const': 'error',
			'prefer-destructuring': [
				'error',
				{ array: true, object: true },
				{ enforceForRenamedProperties: false }
			],
			'prefer-template': 'error',
			'promise/always-return': 'warn',
			'promise/avoid-new': 'warn',
			'promise/catch-or-return': 'error',
			'promise/no-callback-in-promise': 'warn',
			'promise/no-nesting': 'warn',
			'promise/no-promise-in-callback': 'warn',
			'promise/no-return-wrap': 'error',
			'promise/param-names': 'error'
		}
	},
	{
		//TODO: Add official eslint support for Svelte.
		files: ['**/*.svelte.ts'],
		languageOptions: {
			globals: {
				$derived: 'readonly',
				$effect: 'readonly',
				$props: 'readonly',
				$state: 'readonly'
			}
		}
	},
	{
		files: [
			'eslint.config.mjs',
			'src/constants.ts',
			'example/vue/client/**/*.js',
			'example/svelte/pages/**/*.js'
		],
		rules: {
			'no-magic-numbers': 'off'
		}
	},
	{
		files: [
			'eslint.config.mjs',
			'example/vue/scripts/*.ts',
			'example/vue/pages/*.js',
			'example/vue/client/**/*.js',
			'example/vue/pages/**/*.js',
			'example/vue/indexes/**/*.js',
			'example/svelte/pages/**/*.js'
		],
		rules: {
			'import/no-default-export': 'off'
		}
	},
	{
		files: [
			'src/utils/index.ts',
			'src/plugins/index.ts',
			'src/core/index.ts',
			'src/index.ts',
			'example/**/indexes/*',
			'example/html/scripts/*',
			'example/vue/**/*.js'
		],
		rules: {
			'import/no-unused-modules': 'off'
		}
	},
	{
		files: [
			'example/vue/pages/**/*.js',
			'example/vue/components/**/*.js',
			'example/vue/scripts/*.ts',
			'example/vue/indexes/**/*.js',
			'example/vue/client/**/*.js',
			'example/svelte/pages/**/*.js'
		],
		rules: {
			'absolute/explicit-object-types': 'off'
		}
	},
	{
		files: [
			'example/vue/pages/**/*.js',
			'example/vue/components/**/*.js',
			'example/vue/indexes/**/*.js'
		],
		rules: {
			'import/order': 'off'
		}
	},
	{
		files: ['example/vue/scripts/*.ts'],
		rules: {
			'no-duplicate-imports': 'off'
		}
	},
	{
		files: [
			'example/vue/pages/**/*.js',
			'example/vue/client/*.js',
			'example/vue/scripts/*.ts',
			'example/vue/indexes/**/*.js',
			'example/vue/client/**/*.js',
			'example/svelte/pages/**/*.js'
		],
		rules: {
			'@typescript-eslint/no-unused-vars': 'off',
			'func-style': 'off'
		}
	},
	{
		files: ['example/vue/client/*.js', 'example/vue/pages/**/*.js'],
		rules: {
			'absolute/explicit-object-types': 'off'
		}
	},
	{
		files: ['example/svelte/pages/**/*.js'],
		rules: {
			'no-shadow': 'off'
		}
	}
]);
