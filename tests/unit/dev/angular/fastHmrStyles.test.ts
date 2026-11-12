import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tryFastHmr } from '../../../../src/dev/angular/fastHmrCompiler';

/* Angular `styleUrl` with Less or Stylus works in production and in the
 * dev rebuild path. The dev fast path compiled styles synchronously, so a
 * Less/Stylus file that exists failed there and was reported as
 * "Style file not found". Less and Stylus now compile on the fast path, and
 * a file that exists but fails to compile reports the compiler's error. */

const root = resolve(
	import.meta.dir,
	'..',
	'..',
	'..',
	'..',
	'.test-builds',
	`fast-hmr-styles-${process.pid}`
);

const component = (
	className: string,
	styleUrl: string
) => `import { Component } from '@angular/core';

@Component({
	selector: 'app-${className.toLowerCase()}',
	standalone: true,
	styleUrl: '${styleUrl}',
	template: '<p class="proof">styled</p>'
})
export class ${className} {}
`;

const FILES: Record<string, string> = {
	'broken.component.ts': component('BrokenComponent', './broken.scss'),
	'broken.scss': '.proof { color: $undefined-variable; }\n',
	'less.component.ts': component('LessComponent', './styles.less'),
	'missing.component.ts': component('MissingComponent', './nowhere.scss'),
	'styl.component.ts': component('StylComponent', './styles.styl'),
	'styles.less': '@accent: #cb55ee;\n.proof { color: @accent; }\n',
	'styles.styl': 'accent = #55cbee\n.proof\n  color accent\n'
};

const run = (file: string, className: string) =>
	tryFastHmr({
		className,
		componentFilePath: join(root, file),
		projectRoot: root
	});

beforeAll(async () => {
	await mkdir(root, { recursive: true });
	await Promise.all(
		Object.entries(FILES).map(([name, source]) =>
			writeFile(join(root, name), source)
		)
	);
});

afterAll(async () => {
	await rm(root, { force: true, recursive: true });
});

describe('Angular fast HMR styleUrl preprocessing', () => {
	test('compiles a Less styleUrl', async () => {
		const result = await run('less.component.ts', 'LessComponent');

		if (!result.ok) throw new Error(`${result.reason}: ${result.detail}`);
		expect(result.moduleText).toContain('#cb55ee');
	});

	test('compiles a Stylus styleUrl', async () => {
		const result = await run('styl.component.ts', 'StylComponent');

		if (!result.ok) throw new Error(`${result.reason}: ${result.detail}`);
		expect(result.moduleText).toContain('#55cbee');
	});

	test('reports a missing style file as missing', async () => {
		const result = await run('missing.component.ts', 'MissingComponent');

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.reason).toBe('style-resource-not-found');
		expect(result.detail).toContain('Style file not found: ./nowhere.scss');
	});

	test('reports a style that fails to compile with the compiler error', async () => {
		const result = await run('broken.component.ts', 'BrokenComponent');

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.reason).toBe('style-compile-error');
		expect(result.detail).toContain('Could not compile ./broken.scss');
		expect(result.detail).toContain('Undefined variable');
		expect(result.detail).not.toContain('not found');
	});
});
