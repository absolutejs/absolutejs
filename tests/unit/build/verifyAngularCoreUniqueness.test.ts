import { describe, expect, test } from 'bun:test';
import { verifyAngularCoreUniqueness } from '../../../src/build/verifyAngularCoreUniqueness';

/* A page that imports `@absolutejs/absolute/angular` bundles AbsoluteJS's
 * own Angular helpers into its SSR output. Those carry generated-source
 * templates such as "import { REQUEST_CONTEXT } from '@angular/core'" as
 * string literals. The check read every `from '…'` in the text, so those
 * strings counted as a second, bare `@angular/core` next to the real
 * vendor import, and every production build warned about 2 resolutions. */

const SERVER_OUT_DIR = '/app/build';
const PAGE_PATH = `${SERVER_OUT_DIR}/angular/pages/rich.abc123.js`;

const artifact = (path: string, source: string) => ({
	path,
	text: () => Promise.resolve(source)
});

const verify = (artifacts: ReturnType<typeof artifact>[]) =>
	verifyAngularCoreUniqueness(artifacts, SERVER_OUT_DIR, true);

describe('verifyAngularCoreUniqueness', () => {
	test('ignores @angular/core specifiers inside string literals', async () => {
		const page = artifact(
			PAGE_PATH,
			[
				'import { Component } from "../../vendor/server/angular_core.js";',
				'const template = `import { REQUEST_CONTEXT } from \'@angular/core\';`;',
				'const rewrite = (s) => s.replace(/from\\s*[\'"]@angular\\/core[\'"]/g, "x");',
				"const other = \"import('@angular/core')\";",
				'export { Component, template, rewrite, other };'
			].join('\n')
		);

		expect(await verify([page])).toBeUndefined();
	});

	test('accepts every output importing the same vendor file', async () => {
		const pages = [
			artifact(
				PAGE_PATH,
				'import { a } from "../../vendor/server/angular_core.js"; export { a };'
			),
			artifact(
				`${SERVER_OUT_DIR}/angular/pages/other.js`,
				'export const load = () => import("../../vendor/server/angular_core.js");'
			)
		];

		expect(await verify(pages)).toBeUndefined();
	});

	test('still fails when real imports mix a vendor file and a bare specifier', async () => {
		const pages = [
			artifact(
				PAGE_PATH,
				'import { a } from "../../vendor/server/angular_core.js"; export { a };'
			),
			artifact(
				`${SERVER_OUT_DIR}/angular/pages/other.js`,
				'import { b } from "@angular/core"; export { b };'
			)
		];

		await expect(verify(pages)).rejects.toThrow(
			'Angular core multi-instance detected in server bundle'
		);
	});
});
