import { describe, expect, spyOn, test } from 'bun:test';
import { reactServerPageManifestKeys } from '../../../src/build/buildReactServerComponents';
import { asset } from '../../../src/core/lookup';

describe('React Server Components page manifest keys', () => {
	test('appends RSC once, keeping the old doubled key as an alias', () => {
		const { collisions, keys } = reactServerPageManifestKeys([
			'Home',
			'DashboardRSC'
		]);
		expect(keys.get('Home')).toEqual(['HomeRSC']);
		expect(keys.get('DashboardRSC')).toEqual([
			'DashboardRSC',
			'DashboardRSCRSC'
		]);
		expect(collisions).toEqual([]);
	});

	test('a page named exactly RSC is still suffixed', () => {
		expect(reactServerPageManifestKeys(['RSC']).keys.get('RSC')).toEqual([
			'RSCRSC'
		]);
	});

	test('Home and HomeRSC: Home keeps HomeRSC, HomeRSC keeps its old key', () => {
		const { collisions, keys } = reactServerPageManifestKeys([
			'Home',
			'HomeRSC'
		]);
		expect(keys.get('Home')).toEqual(['HomeRSC']);
		expect(keys.get('HomeRSC')).toEqual(['HomeRSCRSC']);
		expect(collisions).toHaveLength(1);
		expect(collisions[0]).toContain('HomeRSC');
	});

	test('asset() warns once in dev when the doubled alias is used', () => {
		const manifest = {
			DashboardRSC: '/build/rsc/DashboardRSC.js',
			DashboardRSCRSC: '/build/rsc/DashboardRSC.js'
		};
		const warn = spyOn(console, 'warn').mockImplementation(
			() => undefined
		);
		try {
			expect(asset(manifest, 'DashboardRSC')).toBe(
				'/build/rsc/DashboardRSC.js'
			);
			expect(warn).not.toHaveBeenCalled();
			expect(asset(manifest, 'DashboardRSCRSC')).toBe(
				'/build/rsc/DashboardRSC.js'
			);
			expect(asset(manifest, 'DashboardRSCRSC')).toBe(
				'/build/rsc/DashboardRSC.js'
			);
			expect(warn).toHaveBeenCalledTimes(1);
			expect(String(warn.mock.calls[0]?.[0])).toContain(
				"asset(manifest, 'DashboardRSC')"
			);
		} finally {
			warn.mockRestore();
		}
	});
});
