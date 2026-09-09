import { describe, expect, test } from 'bun:test';
import { createAbsoluteMobileAuthLinks } from '../../../src/mobile/shellAuth';

type LinkListener = (url: string) => void;
type ReceiptStorage = {
	get: (key: string) => Promise<string | null>;
	set: (key: string, value: string) => Promise<void>;
};

const linkProvider = (launchUrl: string | null) => {
	let listener: LinkListener = () => undefined;

	return {
		provider: {
			getLaunchUrl: async () => launchUrl,
			onOpen: async (next: LinkListener) => {
				listener = next;

				return () => undefined;
			},
			openExternal: async () => undefined
		},
		emit: (url: string) => listener(url)
	};
};

describe('Absolute mobile auth links', () => {
	test('delivers a native OAuth callback only once when launch and live links overlap', async () => {
		const callback =
			'com.example.app:/oauth/callback?code=single-use&state=pending';
		const fixture = linkProvider(callback);
		const links = createAbsoluteMobileAuthLinks(fixture.provider);
		const opened: string[] = [];
		await links.onOpen((url) => opened.push(url));
		fixture.emit(callback);

		expect(await links.getLaunchUrl()).toBeNull();
		await Bun.sleep(0);
		expect(opened).toEqual([callback]);
	});

	test('suppresses a later live delivery after the launch callback is consumed', async () => {
		const callback =
			'com.example.app:/oauth/callback?code=single-use&state=pending';
		const fixture = linkProvider(callback);
		const links = createAbsoluteMobileAuthLinks(fixture.provider);
		const opened: string[] = [];
		await links.onOpen((url) => opened.push(url));

		expect(await links.getLaunchUrl()).toBe(callback);
		fixture.emit(callback);
		await Bun.sleep(0);
		expect(opened).toEqual([]);
	});

	test('continues delivering distinct authorization callbacks', async () => {
		const fixture = linkProvider(null);
		const links = createAbsoluteMobileAuthLinks(fixture.provider);
		const opened: string[] = [];
		await links.onOpen((url) => opened.push(url));

		fixture.emit('com.example.app:/oauth/callback?code=first');
		fixture.emit('com.example.app:/oauth/callback?code=second');
		await Bun.sleep(0);
		expect(opened).toHaveLength(2);
	});

	test('suppresses a callback across process boundaries only after authentication commits it', async () => {
		const callback =
			'com.example.app:/oauth/callback?code=single-use&state=pending';
		const values = new Map<string, string>();
		const storage: ReceiptStorage = {
			get: async (key: string) => values.get(key) ?? null,
			set: async (key: string, value: string) =>
				void values.set(key, value)
		};
		const first = createAbsoluteMobileAuthLinks(
			linkProvider(callback).provider,
			storage
		);

		expect(await first.getLaunchUrl()).toBe(callback);
		expect(
			await createAbsoluteMobileAuthLinks(
				linkProvider(callback).provider,
				storage
			).getLaunchUrl()
		).toBe(callback);

		await first.commitConsumed();
		expect(
			await createAbsoluteMobileAuthLinks(
				linkProvider(callback).provider,
				storage
			).getLaunchUrl()
		).toBeNull();
		expect([...values.values()][0]).not.toContain('single-use');
	});
});
