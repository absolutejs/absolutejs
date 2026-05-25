/* Single source of truth for the per-framework JIT/AOT intermediate
 * output location.
 *
 * Historically each framework compiler wrote its compiled output to
 * `<frameworkRoot>/generated/`, which leaked into the user's source
 * tree (e.g. `src/frontend/generated/`). The new convention places
 * every framework's intermediate output under
 * `<projectRoot>/.absolutejs/generated/<framework>/`, keeping `src/`
 * clean and centralizing all build cache state in one gitignored
 * directory.
 *
 * The relative-import semantics inside generated files are preserved:
 * the whole tree moves together, so a generated module's
 * `../foo.service.js` still resolves to a sibling generated file. The
 * load-bearing constraint is that `compileFramework` and the
 * downstream `core/build.ts` server/client root math both compute the
 * SAME path — which is what this helper guarantees. */

import { join } from 'node:path';

export type GeneratedFramework =
	| 'angular'
	| 'vue'
	| 'svelte'
	| 'react'
	| 'ember';

const GENERATED_DIR_NAME = 'generated';
const ABSOLUTE_CACHE_DIR_NAME = '.absolutejs';

export const getFrameworkGeneratedDir = (
	framework: GeneratedFramework,
	projectRoot: string = process.cwd()
) => join(getGeneratedRoot(projectRoot), framework);
export const getGeneratedRoot = (projectRoot: string = process.cwd()) =>
	join(projectRoot, ABSOLUTE_CACHE_DIR_NAME, GENERATED_DIR_NAME);
