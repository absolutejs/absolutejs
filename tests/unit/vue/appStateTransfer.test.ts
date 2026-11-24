import { describe, expect, spyOn, test } from 'bun:test';
import {
	APP_STATE_GLOBAL,
	createAppStateTransfer,
	serializeAppStateScript
} from '../../../src/vue/appStateTransfer';

/* A Vue page could already install Pinia through `setupApp`, which runs
 * on both sides — so each side worked, separately. What it could not do
 * is get the state ACROSS: Pinia fills its stores during the server
 * render, the browser makes a fresh instance, and every store resets on
 * mount. The visitor sees the server's values, then a flash as hydration
 * replaces them with empty ones.
 *
 * This is a channel, not Pinia support: the framework does not depend on
 * Pinia and the same two calls serve any store a project brings. */

describe('what gets transferred', () => {
	test('a registered snapshot reaches the page', () => {
		const transfer = createAppStateTransfer();
		transfer.snapshots.set('pinia', () => ({ cart: { items: 2 } }));

		expect(serializeAppStateScript(transfer)).toContain(
			`window.${APP_STATE_GLOBAL}`
		);
		expect(serializeAppStateScript(transfer)).toContain('"items":2');
	});

	/* The reason the snapshot is a FUNCTION rather than a value: a store
	 * is empty when `setupApp` registers it and full once the render has
	 * run. Serializing at registration time would transfer an empty store
	 * every single time, and the feature would look like it worked. */
	test('the snapshot is read at serialization time, not registration', () => {
		const transfer = createAppStateTransfer();
		const store: { count: number } = { count: 0 };
		transfer.snapshots.set('store', () => store);
		store.count = 7;

		expect(serializeAppStateScript(transfer)).toContain('"count":7');
	});

	test('a page that transfers nothing gets no script', () => {
		expect(serializeAppStateScript(createAppStateTransfer())).toBe('');
	});

	test('several keys travel together', () => {
		const transfer = createAppStateTransfer();
		transfer.snapshots.set('one', () => 1);
		transfer.snapshots.set('two', () => 2);
		const script = serializeAppStateScript(transfer);

		expect(script).toContain('"one":1');
		expect(script).toContain('"two":2');
	});
});

describe('state that cannot be carried', () => {
	/* A store holding a Map, a class instance or a function would
	 * otherwise throw at the very end of a successful render, turning a
	 * rendered page into a 500. One key is dropped and named. */
	test('an unserializable key is dropped, not thrown', () => {
		const error = spyOn(console, 'error').mockImplementation(
			() => undefined
		);
		const transfer = createAppStateTransfer();
		transfer.snapshots.set('fine', () => ({ ok: true }));
		transfer.snapshots.set('cyclic', () => {
			const node: Record<string, unknown> = {};
			node.self = node;

			return node;
		});
		const script = serializeAppStateScript(transfer);

		expect(script).toContain('"ok":true');
		expect(script).not.toContain('cyclic');
		expect(error).toHaveBeenCalled();
		error.mockRestore();
	});

	test('nothing serializable at all means no script', () => {
		const error = spyOn(console, 'error').mockImplementation(
			() => undefined
		);
		const transfer = createAppStateTransfer();
		transfer.snapshots.set('bad', () => () => undefined);

		expect(serializeAppStateScript(transfer)).toBe('');
		error.mockRestore();
	});
});

describe('the script itself', () => {
	/* It is written into the document, so a value containing `</script>`
	 * — a product description, a user's name — would close the element
	 * early and spill the rest as markup. */
	test('a value cannot close the script element', () => {
		const transfer = createAppStateTransfer();
		transfer.snapshots.set('x', () => ({ html: '</script><img>' }));

		expect(serializeAppStateScript(transfer)).not.toContain(
			'</script><img>'
		);
	});
});
