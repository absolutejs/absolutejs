import { describe, expect, test } from 'bun:test';
import {
	AbsoluteMobilePageProtocolError,
	activateAbsoluteMobilePage
} from '../../../src/mobile/client';
import type { AbsoluteMobilePageEnvelope } from '../../../src/mobile/pageProtocol';

type ClientTarget = {
	__ABSOLUTE_PAGE_RENDER_MODE__?: 'client' | 'hydrate';
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
