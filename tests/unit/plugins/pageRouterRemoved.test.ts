import { expect, test } from 'bun:test';
import * as absolute from '../../../src';
import * as plugins from '../../../src/plugins';

/* `pageRouterPlugin` only logged "Page Router Plugin Not Implemented Yet".
 * It is no longer part of the public API. */
test('pageRouterPlugin is not exported', () => {
	expect('pageRouterPlugin' in plugins).toBe(false);
	expect('pageRouterPlugin' in absolute).toBe(false);
});
