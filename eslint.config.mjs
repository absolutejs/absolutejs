// eslint.config.mjs
import { dirname } from 'path';
import { fileURLToPath } from 'url';
import pluginJs from '@eslint/js';
import stylistic from '@stylistic/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import { defineConfig } from 'eslint/config';
import absolutePlugin from 'eslint-plugin-absolute';
import promisePlugin from 'eslint-plugin-promise';
import securityPlugin from 'eslint-plugin-security';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig([
	{
		ignores: [
			// Dependencies (incl. nested, e.g. benchmark apps).
			'**/node_modules/**',
			// Build / compile output.
			'**/dist/**',
			'**/build/**',
			'**/compiled/**',
			// Generated, cached, and vendored code — not authored by us.
			'**/.absolutejs/**',
			'**/.absolutejs-hmr-*.ts',
			'**/.cache/**',
			'**/generated/**',
			'**/vendor/**',
			'**/indexes/**',
			'**/htmx*.min.js',
			// Checked-in framework compiler snapshots used by the example.
			'example/vue/client/**',
			'example/vue/server/**',
			// Local-only / scratch.
			'.claude/**',
			'.test-builds/**',
			'**/.test-shards/**'
		]
	},

	pluginJs.configs.recommended,

	...tseslint.configs.recommended,

	{
		files: ['**/*.{ts,tsx}'],
		languageOptions: {
			globals: {
				...globals.node,
				// TODO: These should only be applied to the src/core/build.ts file.
				Buffer: 'readonly',
				BuildMessage: 'readonly',
				Bun: 'readonly',
				NodeJS: 'readonly',
				ResolveMessage: 'readonly'
			},
			parser: tsParser,
			parserOptions: {
				createDefaultProgram: true,
				project: './tsconfig.json',
				tsconfigRootDir: __dirname
			}
		},
		plugins: { '@stylistic': stylistic },
		rules: {
			'@stylistic/padding-line-between-statements': [
				'error',
				{ blankLine: 'always', next: 'return', prev: '*' }
			],

			'@typescript-eslint/consistent-type-assertions': [
				'error',
				{ assertionStyle: 'never' }
			],
			'@typescript-eslint/consistent-type-definitions': ['error', 'type'],
			'@typescript-eslint/no-non-null-assertion': 'error',
			'@typescript-eslint/no-unnecessary-type-assertion': 'error',
			'@typescript-eslint/no-unused-vars': [
				'error',
				{ argsIgnorePattern: '^_', varsIgnorePattern: '^_' }
			]
		}
	},
	{
		files: ['**/*.d.ts'],
		rules: {
			'@typescript-eslint/consistent-type-definitions': 'off'
		}
	},
	{
		files: ['**/*.{js,mjs,cjs,json,ts,tsx,jsx}'],
		ignores: ['node_modules/**'],
		languageOptions: {
			globals: {
				...globals.browser
			}
		},
		plugins: {
			absolute: absolutePlugin,
			promise: promisePlugin,
			security: securityPlugin
		},
		rules: {
			// TODO: framework directive defines 2 features + test fixtures; promote to error with test overrides.
			'absolute/angular-one-feature-per-file': 'warn',
			'absolute/explicit-object-types': 'error',
			'absolute/inline-style-limit': 'error',
			'absolute/localize-react-props': 'error',
			'absolute/max-depth-extended': ['error', 1],
			'absolute/max-jsxnesting': ['error', 5],
			'absolute/min-var-length': [
				'error',
				{ allowedVars: ['_', 'id', 'db', 'OK', 'ws'], minLength: 3 }
			],
			'absolute/no-button-navigation': 'error',
			'absolute/no-explicit-return-type': 'error',
			// TODO: 113 inline object types to extract into named aliases; promote to error after cleanup.
			'absolute/no-inline-object-types': 'warn',
			'absolute/no-multi-style-objects': 'error',
			// TODO: studio render helpers + a streaming test return nested JSX; promote to error after refactor/overrides.
			'absolute/no-nested-jsx-return': 'warn',
			'absolute/no-nondeterministic-render': 'error',
			'absolute/no-or-none-component': 'error',
			'absolute/no-redundant-type-annotation': 'error',
			'absolute/no-transition-cssproperties': 'error',
			// TODO: 35 identity aliases to inline; promote to error after cleanup.
			'absolute/no-trivial-alias': 'warn',
			'absolute/no-unnecessary-div': 'error',
			'absolute/no-unnecessary-key': 'error',
			'absolute/no-useless-function': 'error',
			// TODO: 4 trailing `export {}` blocks to inline; one (loadConfig)
			// needs reordering to also satisfy sort-exports. Promote after.
			'absolute/prefer-inline-exports': 'warn',
			'absolute/seperate-style-files': 'error',
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
			'absolute/spring-naming-convention': 'error',
			'arrow-body-style': ['error', 'as-needed'],
			'consistent-return': 'error',
			eqeqeq: 'error',
			'func-style': [
				'error',
				'expression',
				{ allowArrowFunctions: true }
			],
			'no-await-in-loop': 'error',
			'no-debugger': 'error',
			'no-duplicate-case': 'error',
			'no-duplicate-imports': 'error',
			'no-else-return': 'error',
			'no-empty-function': ['error', { allow: ['methods'] }],
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
			'no-restricted-exports': [
				'error',
				{ restrictDefaultExports: { direct: true } }
			],
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
			'no-restricted-syntax': [
				'error',
				{
					message:
						'Do not use IIFEs. Extract to a named function instead.',
					selector:
						'CallExpression[callee.type="ArrowFunctionExpression"]'
				},
				{
					message:
						'Do not use IIFEs. Extract to a named function instead.',
					selector: 'CallExpression[callee.type="FunctionExpression"]'
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
			'**/absolute.config.ts',
			'types/style-module-shim.d.ts',
			'types/vue-shim.d.ts',
			'types/svelte-shim.d.ts'
		],
		rules: {
			'no-restricted-exports': 'off'
		}
	},
	{
		files: ['eslint.config.mjs', 'src/constants.ts'],
		rules: {
			'no-magic-numbers': 'off'
		}
	},
	{
		files: ['src/constants.ts'],
		rules: {
			'absolute/sort-exports': 'off'
		}
	},
	{
		// JSON is parsed as an expression by ESLint's default parser. Requiring
		// a side effect from that expression is not meaningful for data files.
		files: ['**/*.json'],
		rules: {
			'@typescript-eslint/no-unused-expressions': 'off'
		}
	},
	{
		// This fixture intentionally exercises a consumer-authored CommonJS
		// runtime module, so CommonJS globals and require() are its contract.
		files: ['tests/fixtures/compile-dependency-stress/runtime/*.cjs'],
		languageOptions: {
			globals: {
				...globals.commonjs
			}
		},
		rules: {
			'@typescript-eslint/no-require-imports': 'off'
		}
	},
	{
		// Compile fixtures intentionally exercise AbsoluteJS's Angular page
		// descriptor and default error-page conventions verbatim.
		files: ['tests/fixtures/**/angular/pages/*.{ts,tsx}'],
		rules: {
			'absolute/explicit-object-types': 'off',
			'no-restricted-exports': 'off'
		}
	},
	{
		// Compile fixtures preserve framework-native React page declarations,
		// including default convention pages and `never`-returning throw pages.
		files: ['tests/fixtures/**/react/pages/*.{ts,tsx}'],
		rules: {
			'absolute/no-explicit-return-type': 'off',
			'func-style': 'off',
			'no-restricted-exports': 'off'
		}
	},
	{
		// This browser compile fixture intentionally leaves the dynamic import
		// observable so the compiled artifact exposes loader failures directly.
		files: ['tests/fixtures/compile-stress/public/browser.js'],
		rules: {
			'promise/catch-or-return': 'off'
		}
	},
	{
		files: ['tests/**/*.ts'],
		rules: {
			'@typescript-eslint/consistent-type-assertions': 'off',
			'absolute/max-depth-extended': 'off',
			'absolute/min-var-length': 'off',
			'absolute/no-useless-function': 'off',
			'no-await-in-loop': 'off',
			'no-empty-function': 'off',
			'no-magic-numbers': 'off',
			'promise/avoid-new': 'off'
		}
	},
	{
		// `usePageContext` re-types Angular's `REQUEST_CONTEXT: InjectionToken<unknown>`
		// as the caller-provided generic. The cast is the entire point of the
		// composable — it gives user code a typed handle to the per-request
		// context without forcing every page to repeat the assertion.
		files: ['src/angular/composables/usePageContext.ts'],
		rules: {
			'@typescript-eslint/consistent-type-assertions': 'off'
		}
	},
	{
		// The ESLint Studio is internal tooling: a flat-config AST walker plus
		// a React rule-browser UI. Deep nesting is inherent to tree walking,
		// and the recursive serializers need return-type annotations TypeScript
		// can't otherwise infer (literal widening + self-reference).
		files: ['src/cli/eslint/studio/**'],
		rules: {
			'absolute/max-depth-extended': 'off',
			'absolute/no-explicit-return-type': 'off'
		}
	},
	{
		// These HMR internals are stateful compiler/event walkers. Their nested
		// branches encode AST ancestry and event phases; flattening them into
		// detached helpers would obscure the state invariants they enforce.
		files: [
			'src/dev/angular/fastHmrCompiler.ts',
			'src/dev/rebuildTrigger.ts'
		],
		rules: {
			'absolute/max-depth-extended': 'off'
		}
	},
	{
		// Rebuild batches intentionally serialize dependent compile and publish
		// phases; concurrent iterations would expose partial generated output.
		files: ['src/dev/rebuildTrigger.ts'],
		rules: {
			'no-await-in-loop': 'off'
		}
	},
	{
		// Dependency traversal and lock polling are intentionally ordered:
		// parallel iterations would violate graph order or lock ownership.
		files: ['src/dev/moduleServer.ts', 'src/utils/buildDirectoryLock.ts'],
		rules: {
			'no-await-in-loop': 'off'
		}
	},
	{
		// Build orchestration and the development module/watch graph coordinate
		// ordered lifecycle phases with localized recovery branches. Extracting
		// those branches would separate invariants from the state they protect.
		files: [
			'src/core/build.ts',
			'src/core/devBuild.ts',
			'src/dev/dependencyGraph.ts',
			'src/dev/fileWatcher.ts',
			'src/dev/moduleServer.ts',
			'src/dev/pathUtils.ts',
			'src/dev/serverEntryWatcher.ts',
			'src/dev/transformCache.ts'
		],
		rules: {
			'absolute/max-depth-extended': 'off'
		}
	},
	{
		// Static route analysis follows nested TypeScript AST nodes and the
		// ownership resolver walks nested component metadata. Their depth
		// mirrors source-tree ancestry rather than application control flow.
		files: [
			'src/*/staticAnalyzeSpaRoutes.ts',
			'src/dev/angular/resolveOwningComponents.ts'
		],
		rules: {
			'absolute/max-depth-extended': 'off'
		}
	},
	{
		// Framework HMR/resource adapters walk nested runtime metadata, and the
		// router matcher mirrors nested segment/parameter structure.
		files: [
			'src/angular/angularPatch.ts',
			'src/angular/composables/useResource.ts',
			'src/angular/hmrPreserveCore.ts',
			'src/angular/pageHandler.ts',
			'src/svelte/router/goto.ts',
			'src/svelte/router/matchPath.ts',
			'src/vue/useResource.ts'
		],
		rules: {
			'absolute/max-depth-extended': 'off'
		}
	},
	{
		// CLI configuration editors traverse nested config schemas, while the
		// compile/dev/build scripts coordinate ordered lifecycle stages. Their
		// nesting represents schema or pipeline structure, not request logic.
		files: [
			'scripts/build.ts',
			'src/cli/config/**',
			'src/cli/scripts/compile.ts',
			'src/cli/scripts/dev.ts',
			'src/cli/scripts/eslint.ts',
			'src/cli/scripts/start.ts'
		],
		rules: {
			'absolute/max-depth-extended': 'off'
		}
	},
	{
		// HMR clients and networking/build-lock helpers implement protocol state
		// machines; the utility scanners walk nested filesystem/config records.
		// Their branch depth mirrors protocol or input structure.
		files: [
			'src/dev/angular/hmrInjectionPlugin.ts',
			'src/dev/client/**',
			'src/dev/devCert.ts',
			'src/plugins/networking.ts',
			'src/utils/buildDirectoryLock.ts',
			'src/utils/generateSitemap.ts',
			'src/utils/projectRoot.ts',
			'src/utils/resolveConvention.ts',
			'src/utils/spaRouteManifest.ts'
		],
		rules: {
			'absolute/max-depth-extended': 'off'
		}
	},
	{
		// Config Studio panels use layout-only containers and keep callbacks in
		// the state-owning panel so validation and persistence remain atomic.
		files: ['src/cli/config/**/*.{ts,tsx}'],
		rules: {
			'absolute/localize-react-props': 'off',
			'absolute/max-jsxnesting': 'off',
			'absolute/no-unnecessary-div': 'off'
		}
	},
	{
		// The workspace TUI is a single lifecycle coordinator for terminal
		// input, child processes, and redraw state.
		files: ['src/cli/workspaceTui.ts'],
		rules: {
			'absolute/max-depth-extended': 'off'
		}
	},
	{
		// Benchmark samples must execute sequentially so one measurement cannot
		// consume CPU, filesystem, or server state belonging to another sample.
		files: ['benchmarks/**'],
		rules: {
			'no-await-in-loop': 'off'
		}
	}
]);
