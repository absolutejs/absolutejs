import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import {
	createSSRApp,
	defineComponent,
	getCurrentInstance,
	getCurrentScope,
	h
} from 'vue';
import { renderToString } from 'vue/server-renderer';
import { handleVuePageRequest, useServerData } from '../../../src/vue';
import {
	clearingSetupStateOnFailure,
	clearLeakedVueSetupState
} from '../../../src/vue/clearLeakedSetupState';

/* One failed server render used to leave Vue believing a component was
 * being set up for the rest of the process, so every "am I inside
 * setup()?" guard answered yes — `useServerData` from a plain function
 * stopped reporting the misuse. These pin the state Vue is left in, for
 * both ways a component can throw, and through the page handler itself. */

const SetupThrows = defineComponent({
	setup() {
		throw new Error('setup exploded');
	}
});

const RenderThrows = defineComponent({
	setup: () => () => {
		throw new Error('render exploded');
	}
});

const Fine = defineComponent({ setup: () => () => h('p', 'fine') });

const loadNothing = async () => null;

const expectIdle = () => {
	expect(getCurrentInstance()).toBeNull();
	expect(getCurrentScope()).toBeUndefined();
	expect(() => useServerData('loose', loadNothing)).toThrow(
		/must be called inside a Vue component's setup\(\)/
	);
};

// A test here that fails must not hand its leak to the next file.
afterEach(async () => {
	await clearLeakedVueSetupState();
});

describe('what Vue is left with after a server render fails', () => {
	test.each([
		['setup()', SetupThrows, 'setup exploded'],
		['a render function', RenderThrows, 'render exploded']
	])(
		'%s throwing leaks the instance; the reset clears it',
		async (_where, Component, message) => {
			await expect(
				renderToString(createSSRApp(Component))
			).rejects.toThrow(message);
			// The defect, stated: this is what Vue leaves behind.
			expect(getCurrentInstance()).not.toBeNull();

			expect(await clearLeakedVueSetupState()).toBe(true);
			expectIdle();
		}
	);

	test('the wrapper clears it and passes the error on', async () => {
		await expect(
			clearingSetupStateOnFailure(
				renderToString(createSSRApp(SetupThrows))
			)
		).rejects.toThrow('setup exploded');

		expectIdle();
	});

	test('with nothing leaked the reset reports so and changes nothing', async () => {
		expect(await clearLeakedVueSetupState()).toBe(false);
		expect(await renderToString(createSSRApp(Fine))).toBe('<p>fine</p>');
		expect(await clearLeakedVueSetupState()).toBe(false);
	});

	test('a render after a cleared failure is unaffected', async () => {
		await clearingSetupStateOnFailure(
			renderToString(createSSRApp(RenderThrows))
		).catch(() => undefined);

		expect(await renderToString(createSSRApp(Fine))).toBe('<p>fine</p>');
		expectIdle();
	});
});

describe('a Vue page that throws, through the page handler', () => {
	const renderPage = async (
		Page: ReturnType<typeof defineComponent>,
		streaming: boolean
	) => {
		const errorSpy = spyOn(console, 'error').mockImplementation(() => {});
		try {
			const response = await handleVuePageRequest({
				indexPath: '/leak.js',
				Page,
				pagePath: '/tests/leak.vue',
				streaming
			});
			// A streamed page fails while its body is read.
			await response.text().catch(() => undefined);
		} catch {
			// A page that throws may reject or answer with an error page;
			// either way the state it leaves is what is asserted.
		} finally {
			errorSpy.mockRestore();
		}
	};

	test.each([
		['setup() throws, buffered', SetupThrows, false],
		['setup() throws, streamed', SetupThrows, true],
		['render throws, buffered', RenderThrows, false],
		['render throws, streamed', RenderThrows, true]
	])('%s: no instance is left behind', async (_label, Page, streaming) => {
		await renderPage(Page, streaming);

		expectIdle();
	});
});
