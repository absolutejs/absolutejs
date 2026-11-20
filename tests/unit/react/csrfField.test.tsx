import { afterEach, describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { CsrfField } from '../../../src/react/components/CsrfField';
import { registerCsrfTokenGetter } from '../../../src/utils/csrfTokenRef';

const GETTER_KEY = Symbol.for('absolutejs.csrfTokenGetter');

afterEach(() => Reflect.deleteProperty(globalThis, GETTER_KEY));

describe('React CsrfField', () => {
	test('renders the hidden field with the request token', () => {
		registerCsrfTokenGetter(() => 'value.signature');
		expect(renderToStaticMarkup(<CsrfField />)).toBe(
			'<input type="hidden" name="_csrf" value="value.signature"/>'
		);
	});

	test('renders nothing without a token', () => {
		expect(renderToStaticMarkup(<CsrfField />)).toBe('');
	});
});
