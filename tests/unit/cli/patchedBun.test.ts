import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	PATCHED_BUN_RELEASE,
	type BvmRunner,
	bvmPlatformPackage,
	findBvm,
	installPatchedBun,
	installVerifiedPatchedBun,
	installedPatchedBun,
	migrateLegacyPatchedBun,
	parsePatchedBunChoice,
	patchedBunOfferState,
	readPatchedBunPreference,
	writePatchedBunPreference
} from '../../../src/cli/patchedBun';

const homes: string[] = [];
const tempHome = () => {
	const home = mkdtempSync(join(tmpdir(), 'absolute-patched-bun-'));
	homes.push(home);

	return home;
};
afterEach(() => {
	for (const home of homes.splice(0))
		rmSync(home, { force: true, recursive: true });
});

const offerContext: Parameters<typeof patchedBunOfferState>[0] = {
	bunVersion: '1.4.0',
	bvm: true,
	ci: false,
	installed: false,
	interactive: true,
	now: new Date('2026-09-28T12:00:00Z'),
	preference: null,
	supported: false,
	usesReact: true
};

describe('finding bvm', () => {
	test('names the platform package the way @absolutejs/bvm does', () => {
		expect(bvmPlatformPackage('linux', 'x64')).toBe(
			'@absolutejs/bvm-linux-x64'
		);
		expect(bvmPlatformPackage('darwin', 'arm64')).toBe(
			'@absolutejs/bvm-darwin-arm64'
		);
		expect(bvmPlatformPackage('win32', 'x64')).toBe(
			'@absolutejs/bvm-windows-x64'
		);
		expect(bvmPlatformPackage('freebsd', 'x64')).toBeNull();
		expect(bvmPlatformPackage('linux', 'ia32')).toBeNull();
	});

	test('finds the binary npm installed with AbsoluteJS', () => {
		const bvm = findBvm();
		expect(bvm).not.toBeNull();
		expect(bvm).toContain('bvm-');
	});
});

describe('when absolute dev offers the patched Bun', () => {
	test('offers only on stock Bun, interactively, in a React project', () => {
		expect(patchedBunOfferState(offerContext)).toBe('offer');
		expect(patchedBunOfferState({ ...offerContext, supported: true })).toBe(
			'runtime-supports-refresh'
		);
		expect(patchedBunOfferState({ ...offerContext, installed: true })).toBe(
			'installed'
		);
		expect(
			patchedBunOfferState({ ...offerContext, usesReact: false })
		).toBe('not-a-react-project');
		expect(patchedBunOfferState({ ...offerContext, bvm: false })).toBe(
			'unsupported-platform'
		);
		expect(patchedBunOfferState({ ...offerContext, ci: true })).toBe(
			'non-interactive'
		);
		expect(
			patchedBunOfferState({ ...offerContext, interactive: false })
		).toBe('non-interactive');
	});

	test('never replaces a newer Bun with the older patched one', () => {
		// Relative to the pinned release, so the test holds across bumps.
		const [major, minor, patch] = PATCHED_BUN_RELEASE.bunVersion
			.split('.')
			.map(Number);
		expect(
			patchedBunOfferState({
				...offerContext,
				bunVersion: `${major}.${minor}.${Number(patch) + 1}`
			})
		).toBe('runtime-newer');
		expect(
			patchedBunOfferState({ ...offerContext, bunVersion: '1.3.14' })
		).toBe('offer');
	});

	test('honors "Don\'t ask again" and "Ask me later"', () => {
		expect(
			patchedBunOfferState({
				...offerContext,
				preference: { decision: 'never' }
			})
		).toBe('declined');
		expect(
			patchedBunOfferState({
				...offerContext,
				preference: {
					askAfter: '2026-09-29T00:00:00Z',
					decision: 'later'
				}
			})
		).toBe('asked-recently');
		expect(
			patchedBunOfferState({
				...offerContext,
				preference: {
					askAfter: '2026-09-28T00:00:00Z',
					decision: 'later'
				}
			})
		).toBe('offer');
	});

	test('reads the answer', () => {
		expect(parsePatchedBunChoice('')).toBe('install');
		expect(parsePatchedBunChoice('1')).toBe('install');
		expect(parsePatchedBunChoice(' 2 ')).toBe('later');
		expect(parsePatchedBunChoice('later')).toBe('later');
		expect(parsePatchedBunChoice('3')).toBe('never');
		expect(parsePatchedBunChoice("don't ask")).toBe('never');
		expect(parsePatchedBunChoice('9')).toBeNull();
	});

	test('remembers the choice in ~/.absolutejs', () => {
		const home = tempHome();
		expect(readPatchedBunPreference(home)).toBeNull();
		writePatchedBunPreference(
			{ askAfter: '2026-09-29T00:00:00.000Z', decision: 'later' },
			home
		);
		expect(readPatchedBunPreference(home)).toEqual({
			askAfter: '2026-09-29T00:00:00.000Z',
			decision: 'later'
		});
		writePatchedBunPreference({ decision: 'never' }, home);
		expect(readPatchedBunPreference(home)).toEqual({ decision: 'never' });
		writePatchedBunPreference(null, home);
		expect(readPatchedBunPreference(home)).toBeNull();
	});
});

describe('installing the patched Bun with bvm', () => {
	/* A fake bvm: records every call and keeps an installed set. */
	const fakeBvm = (options: { failInstall?: boolean } = {}) => {
		const installed = new Set<string>();
		const calls: string[][] = [];
		const run: BvmRunner = (args) => {
			calls.push(args);
			const [command, version = ''] = args;
			if (command === 'install') {
				if (options.failInstall) return { status: 1, stdout: '' };
				installed.add(version);

				return { status: 0, stdout: '' };
			}
			if (command === 'uninstall') {
				installed.delete(version);

				return { status: 0, stdout: '' };
			}
			if (command === 'which' && installed.has(version))
				return { status: 0, stdout: `/bvm/versions/${version}/bun\n` };

			return { status: 1, stdout: '' };
		};

		return { calls, installed, run };
	};

	test('asks bvm for exactly the pinned patched version', () => {
		const bvm = fakeBvm();
		expect(installedPatchedBun(bvm.run)).toBeNull();
		expect(installPatchedBun(bvm.run)).toBe(
			`/bvm/versions/${PATCHED_BUN_RELEASE.version}/bun`
		);
		expect(bvm.calls[1]).toEqual(['install', PATCHED_BUN_RELEASE.version]);
		expect(installedPatchedBun(bvm.run)).toBe(
			`/bvm/versions/${PATCHED_BUN_RELEASE.version}/bun`
		);
	});

	test('fails clearly without bvm or when bvm refuses the download', () => {
		expect(() => installPatchedBun(null)).toThrow('bvm is not available');
		expect(() =>
			installPatchedBun(fakeBvm({ failInstall: true }).run)
		).toThrow('bvm could not install');
	});

	test('uninstalls a build that fails its probe', () => {
		const bvm = fakeBvm();
		expect(() =>
			installVerifiedPatchedBun(tempHome(), bvm.run, () => false)
		).toThrow('did not pass its check');
		expect(bvm.installed.size).toBe(0);
	});

	test('moves an install from ~/.absolutejs/bun onto bvm', () => {
		const home = tempHome();
		const legacy = join(
			home,
			'.absolutejs',
			'bun',
			'bun-v1.4.0-absolute.2'
		);
		mkdirSync(legacy, { recursive: true });
		writePatchedBunPreference({ decision: 'never' }, home);
		const bvm = fakeBvm();
		expect(migrateLegacyPatchedBun(home, bvm.run, () => true)).toBe(
			`/bvm/versions/${PATCHED_BUN_RELEASE.version}/bun`
		);
		expect(existsSync(join(home, '.absolutejs', 'bun'))).toBe(false);
		expect(readPatchedBunPreference(home)).toBeNull();
		// Nothing to move: no download.
		const untouched = fakeBvm();
		expect(migrateLegacyPatchedBun(tempHome(), untouched.run)).toBeNull();
		expect(untouched.calls).toEqual([]);
	});
});
