import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
	compileStyleFileIfNeeded,
	compileStyleFileIfNeededSync,
	compileStyleSource
} from '../../../src/build/stylePreprocessor';

let root = '';

beforeAll(async () => {
	root = await mkdtemp(join(tmpdir(), 'absolutejs-style-locations-'));
});

afterAll(async () => {
	await rm(root, { force: true, recursive: true });
});

const write = async (name: string, contents: string) => {
	const path = join(root, name);
	await writeFile(path, contents);

	return path;
};

const failureOf = async (path: string) => {
	try {
		await compileStyleSource(path);
	} catch (error) {
		return error instanceof Error ? error.message : String(error);
	}

	throw new Error(`${path} compiled; it was meant to fail`);
};

/* The first line of the message is `<language> compile failed in
 * <path><location>`. Every Error in Bun carries `line` and `column` for
 * the JavaScript that threw, and that used to be printed as the
 * stylesheet's: a four-line file reported line 8310. */
describe('where a stylesheet compile error says it is', () => {
	test('Sass: the line and column of the stylesheet, from 1', async () => {
		const path = await write(
			'bad.scss',
			'.a {\n  color: red;\n  width: $missing;\n}\n'
		);
		const [headline] = (await failureOf(path)).split('\n');

		expect(headline).toBe(`scss compile failed in ${path}:3:10`);
	});

	test('Less: the line and column of the stylesheet, from 1', async () => {
		const path = await write(
			'bad.less',
			'.a {\n  color: red;\n  width: @missing;\n}\n'
		);
		const [headline] = (await failureOf(path)).split('\n');

		expect(headline).toBe(`less compile failed in ${path}:3:10`);
	});

	/* Stylus reports no structured position, only its own message, which
	 * names the line. No number is better than the compiler's. */
	test('Stylus: no location of its own, and the compiler message kept', async () => {
		const path = await write(
			'bad.styl',
			'.a\n  color red\n  width missing(\n'
		);
		const message = await failureOf(path);
		const [headline] = message.split('\n');

		expect(headline).toBe(`stylus compile failed in ${path}`);
		expect(message).toContain(`${path}:4`);
	});

	/* The error is in the partial. Its line after the ENTRY's path would
	 * point at unrelated text; Sass's own message names the partial. */
	test('Sass: an error in an imported partial is not given the entry’s path', async () => {
		await write(
			'_broken.scss',
			'// one\n// two\n// three\n// four\n.b { width: $missing; }\n'
		);
		const path = await write('entry.scss', '@use "broken";\n');
		const message = await failureOf(path);
		const [headline] = message.split('\n');

		expect(headline).toBe(`scss compile failed in ${path}`);
		expect(message).toContain('_broken.scss 5:');
	});
});

/* Plain `@import "<path>";` statements are inlined so a component's
 * styles are self-contained. One with a media query, `layer()` or
 * `supports()` cannot be inlined as-is — the rules would apply
 * unconditionally — and used to be: the path matched, the file was
 * pasted in, and the qualifier was left behind as stray text. */
describe('inlining CSS @import statements', () => {
	const compileBoth = async (path: string) => [
		await compileStyleFileIfNeeded(path),
		compileStyleFileIfNeededSync(path)
	];

	test('a plain import is inlined', async () => {
		await write('plain-part.css', '.part { color: red; }');
		const path = await write(
			'plain.css',
			'@import "./plain-part.css";\n.own { color: blue; }\n'
		);

		(await compileBoth(path)).forEach((css) => {
			expect(css).toContain('.part { color: red; }');
			expect(css).not.toContain('@import');
		});
	});

	test.each([
		['a media query', '@import "./print.css" print;'],
		[
			'a media query list',
			'@import "./print.css" screen and (min-width: 40em), print;'
		],
		['a layer', '@import "./print.css" layer(base);'],
		[
			'a supports condition',
			'@import "./print.css" supports(display: grid);'
		],
		['a qualifier on the next line', '@import "./print.css"\n  print;']
	])('an import with %s passes through whole', async (_label, statement) => {
		await write('print.css', '.printed { display: none; }');
		const path = await write(
			'qualified.css',
			`${statement}\n.own { color: blue; }\n`
		);

		(await compileBoth(path)).forEach((css) => {
			expect(css).toContain(statement);
			expect(css).not.toContain('.printed');
			expect(css).toContain('.own { color: blue; }');
		});
	});

	test('an import with no semicolon before the next rule is still inlined', async () => {
		await write('loose-part.css', '.loose { color: red; }');
		const path = await write(
			'loose.css',
			'@import "./loose-part.css"\n.own { color: blue; }\n'
		);

		(await compileBoth(path)).forEach((css) => {
			expect(css).toContain('.loose { color: red; }');
			expect(css).toContain('.own { color: blue; }');
		});
	});
});
