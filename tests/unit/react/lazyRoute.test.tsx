import { describe, expect, test } from 'bun:test';
import type { ReactNode } from 'react';
import { renderToReadableStream } from 'react-dom/server';
import { lazyRoute } from '../../../src/react/router/lazyRoute';

const html = async (node: ReactNode) =>
	new Response(await renderToReadableStream(node)).text();

const Billing = ({ plan }: { plan: string }) => <h1>billing {plan}</h1>;

let loads = 0;
const CountedBilling = lazyRoute(async () => {
	loads += 1;

	return { Billing };
}, 'Billing');

let attempt = 0;
const FlakyBilling = lazyRoute(async () => {
	attempt += 1;
	if (attempt === 1) throw new Error('chunk went missing');

	return { Billing };
}, 'Billing');

const parsedModule = async () => {
	const module: { Billing: typeof Billing } = JSON.parse(
		'{"Billing":"not a component"}'
	);

	return module;
};
const BrokenBilling = lazyRoute(parsedModule, 'Billing');

const PlainBilling = lazyRoute(async () => ({ Billing }), 'Billing');

describe('lazyRoute', () => {
	test('the server renders the page in full', async () => {
		const out = await html(<PlainBilling plan="pro" />);

		expect(out).toContain('billing');
		expect(out).toContain('pro');
	});

	test('preload loads once, and a loaded page renders at once', async () => {
		await CountedBilling.preload();
		await CountedBilling.preload();
		await html(<CountedBilling plan="pro" />);

		expect(loads).toBe(1);
	});

	test('a failed load is tried again, not cached', async () => {
		// On the server a route starts loading when it is defined: that
		// first attempt has failed by now.
		await Bun.sleep(0);
		expect(attempt).toBe(1);
		await FlakyBilling.preload();
		expect(attempt).toBe(2);
		expect(await html(<FlakyBilling plan="team" />)).toContain('team');
	});

	test('a module without the named component says so', async () => {
		await expect(BrokenBilling.preload()).rejects.toThrow(
			'no component named "Billing"'
		);
	});
});
