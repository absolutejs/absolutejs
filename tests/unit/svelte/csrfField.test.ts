import { afterAll, afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Component } from 'svelte';
import { compile } from 'svelte/compiler';
import { render } from 'svelte/server';
import { registerCsrfTokenGetter } from '../../../src/utils/csrfTokenRef';

const GETTER_KEY = Symbol.for('absolutejs.csrfTokenGetter');
const SOURCE = resolve(
	import.meta.dir,
	'../../../src/svelte/components/CsrfField.svelte'
);
const REF = resolve(import.meta.dir, '../../../src/utils/csrfTokenRef.ts');

// Inside the repo so the compiled module resolves `svelte` from node_modules.
const directory = mkdtempSync(
	join(resolve(import.meta.dir, '../../..'), '.svelte-csrf-')
);

/* Compiled once per call, under a fresh name: the component reads the
 * token at init, so a cached module would answer with the first test's. */
let counter = 0;
const loadField = async () => {
	const { js } = compile(readFileSync(SOURCE, 'utf8'), {
		filename: 'CsrfField.svelte',
		generate: 'server'
	});
	counter += 1;
	const modulePath = join(directory, `CsrfField${counter}.js`);
	writeFileSync(
		modulePath,
		js.code.replace("'../../utils/csrfTokenRef'", JSON.stringify(REF))
	);
	const loaded: { default: Component } = await import(modulePath);

	return loaded.default;
};

afterEach(() => Reflect.deleteProperty(globalThis, GETTER_KEY));
afterAll(() => rmSync(directory, { force: true, recursive: true }));

describe('Svelte CsrfField', () => {
	test('renders the hidden field with the request token', async () => {
		registerCsrfTokenGetter(() => 'value.signature');
		const { body } = render(await loadField());
		expect(body).toContain('name="_csrf"');
		expect(body).toContain('value="value.signature"');
		expect(body).toContain('type="hidden"');
	});

	test('renders no field without a token', async () => {
		const { body } = render(await loadField());
		expect(body).not.toContain('_csrf');
	});
});
