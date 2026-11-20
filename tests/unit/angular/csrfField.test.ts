import { afterEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CsrfFieldComponent } from '../../../src/angular/components/csrf-field.component';
import {
	registerCsrfTokenGetter,
	CSRF_FIELD_NAME
} from '../../../src/utils/csrfTokenRef';

const GETTER_KEY = Symbol.for('absolutejs.csrfTokenGetter');

afterEach(() => Reflect.deleteProperty(globalThis, GETTER_KEY));

const source = () =>
	readFileSync(
		resolve(
			import.meta.dir,
			'../../../src/angular/components/csrf-field.component.ts'
		),
		'utf8'
	);

describe('Angular CsrfFieldComponent', () => {
	test('takes the token from the request it was rendered for', () => {
		registerCsrfTokenGetter(() => 'value.signature');
		expect(new CsrfFieldComponent().token).toBe('value.signature');
		expect(new CsrfFieldComponent().fieldName).toBe(CSRF_FIELD_NAME);
	});

	test('has no token when the app issues none, so it renders nothing', () => {
		expect(new CsrfFieldComponent().token).toBeUndefined();
		// The @if is what turns that into no element at all.
		expect(source()).toContain('@if (token)');
	});

	test('stays inside its own directory for the partial compile', () => {
		// scripts/build.ts rewrites exactly this specifier into the temp
		// workspace; any other cross-directory import emits nothing.
		const imports = source().match(/from '[^']+'/g) ?? [];
		expect(imports).toEqual([
			"from '@angular/core'",
			"from '../../utils/csrfTokenRef'"
		]);
	});
});
