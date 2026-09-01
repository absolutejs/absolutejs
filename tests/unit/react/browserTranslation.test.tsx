import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { hydrateRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import {
	captureSsrTextBaselines,
	prepareBrowserTranslationHydration
} from '../../../src/client/browserTranslation';

beforeAll(() => GlobalRegistrator.register());
afterAll(() => GlobalRegistrator.unregister());

describe('React browser translation hydration', () => {
	test('keeps browser-translated text without a hydration mismatch', async () => {
		document.body.innerHTML =
			'<div id="root"><section><h3>AI Matching</h3></section></div>';
		const container = document.querySelector<HTMLElement>('#root');
		const heading = document.querySelector<HTMLElement>('h3');
		if (container === null || heading === null)
			throw new Error('fixture missing');
		captureSsrTextBaselines(container);
		heading.textContent = 'AIマッチング';
		const errors: unknown[][] = [];
		const originalError = console.error;
		console.error = (...args) => errors.push(args);

		const restoreTranslation =
			prepareBrowserTranslationHydration(container);
		let root: ReturnType<typeof hydrateRoot> | undefined;
		flushSync(() => {
			root = hydrateRoot(
				container,
				<section>
					<h3>AI Matching</h3>
				</section>
			);
		});
		restoreTranslation();
		await Bun.sleep(10);

		console.error = originalError;
		expect(container.querySelector('h3')?.textContent).toBe('AIマッチング');
		expect(errors).toHaveLength(0);
		root?.unmount();
		await Bun.sleep(10);
	});
});
