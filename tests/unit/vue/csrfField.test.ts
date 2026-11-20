import { afterEach, describe, expect, test } from 'bun:test';
import { createSSRApp } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { CsrfField } from '../../../src/vue/components/CsrfField';
import { registerCsrfTokenGetter } from '../../../src/utils/csrfTokenRef';

const GETTER_KEY = Symbol.for('absolutejs.csrfTokenGetter');

afterEach(() => Reflect.deleteProperty(globalThis, GETTER_KEY));

const render = () => renderToString(createSSRApp(CsrfField));

describe('Vue CsrfField', () => {
	test('renders the hidden field with the request token', async () => {
		registerCsrfTokenGetter(() => 'value.signature');
		expect(await render()).toBe(
			'<input name="_csrf" type="hidden" value="value.signature">'
		);
	});

	test('renders nothing without a token', async () => {
		expect(await render()).toBe('<!---->');
	});
});
