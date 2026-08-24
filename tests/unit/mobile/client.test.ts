import { describe, expect, test } from 'bun:test';
import {
	AbsoluteMobilePageProtocolError,
	activateAbsoluteMobilePage
} from '../../../src/mobile/client';
import type { AbsoluteMobilePageEnvelope } from '../../../src/mobile/pageProtocol';

type ClientTarget = {
	__ABSOLUTE_PAGE_DISPOSE__?: () => Promise<void> | void;
	__ABSOLUTE_PAGE_READY__?: Promise<unknown>;
	__ABSOLUTE_PAGE_RENDER_MODE__?: 'client' | 'hydrate';
	__ABS_ANGULAR_REQUEST_CONTEXT__?: Record<string, unknown>;
	__INITIAL_PROPS__?: Record<string, unknown>;
};
type LoadedPage = { contract: string; pageId: string };

const pageEnvelope: AbsoluteMobilePageEnvelope = {
	protocol: 1,
	response: {
		contract: 'account@2',
		framework: 'react',
		kind: 'page',
		pageId: 'Account',
		props: { name: 'Ada' },
		status: 200
	}
};

describe('mobile page client activation', () => {
	test('installs props and client-render mode before loading an embedded page', async () => {
		const target: ClientTarget = {};
		let loaded: LoadedPage | undefined;
		const result = await activateAbsoluteMobilePage(pageEnvelope, {
			target,
			loadPage: async (input) => {
				expect(target.__INITIAL_PROPS__).toEqual({ name: 'Ada' });
				expect(target.__ABSOLUTE_PAGE_RENDER_MODE__).toBe('client');
				loaded = input;
			}
		});

		expect(loaded).toEqual({ contract: 'account@2', pageId: 'Account' });
		expect(result).toEqual({
			contract: 'account@2',
			kind: 'rendered',
			pageId: 'Account'
		});
	});

	test('disposes the previous framework and awaits the next mount', async () => {
		const events: string[] = [];
		let markReady: (() => void) | undefined;
		const target: ClientTarget = {
			__ABSOLUTE_PAGE_DISPOSE__: async () => {
				events.push('dispose');
			}
		};
		const activation = activateAbsoluteMobilePage(pageEnvelope, {
			target,
			loadPage: async () => {
				events.push('load');
				target.__ABSOLUTE_PAGE_READY__ = new Promise<void>(
					(resolve) => {
						markReady = resolve;
					}
				);
			}
		});
		await Bun.sleep(0);

		expect(events).toEqual(['dispose', 'load']);
		expect(target.__ABS_ANGULAR_REQUEST_CONTEXT__).toEqual({
			name: 'Ada'
		});
		let activated = false;
		void activation.then(() => {
			activated = true;

			return undefined;
		});
		await Bun.sleep(0);
		expect(activated).toBe(false);
		markReady?.();
		await activation;
		expect(activated).toBe(true);
	});

	test('disposes each framework exactly once across A to B to A navigation', async () => {
		const events: string[] = [];
		const target: ClientTarget = {};
		const activate = (framework: 'react' | 'vue', pageId: string) =>
			activateAbsoluteMobilePage(
				{
					protocol: 1,
					response: {
						contract: `${framework}@1`,
						framework,
						kind: 'page',
						pageId,
						props: { pageId },
						status: 200
					}
				},
				{
					target,
					loadPage: async () => {
						events.push(`mount:${framework}`);
						target.__ABSOLUTE_PAGE_DISPOSE__ = () => {
							events.push(`dispose:${framework}`);
						};
					}
				}
			);

		await activate('react', 'Account');
		await activate('vue', 'Settings');
		await activate('react', 'Account');

		expect(events).toEqual([
			'mount:react',
			'dispose:react',
			'mount:vue',
			'dispose:vue',
			'mount:react'
		]);
	});

	test('returns update metadata without loading executable code', async () => {
		let loaded = false;
		const result = await activateAbsoluteMobilePage(
			{
				protocol: 1,
				response: {
					kind: 'upgrade-required',
					pageId: 'Account',
					reason: 'page-contract',
					supportedContracts: ['account@3']
				}
			},
			{
				target: {},
				loadPage: async () => {
					loaded = true;
				}
			}
		);

		expect(loaded).toBe(false);
		expect(result.kind).toBe('upgrade-required');
	});

	test('rejects malformed props before consulting the local page registry', async () => {
		let loaded = false;
		const activation = activateAbsoluteMobilePage(
			{
				...pageEnvelope,
				response: { ...pageEnvelope.response, props: 'not-an-object' }
			},
			{
				target: {},
				loadPage: async () => {
					loaded = true;
				}
			}
		);

		await expect(activation).rejects.toBeInstanceOf(
			AbsoluteMobilePageProtocolError
		);
		expect(loaded).toBe(false);
	});
});
