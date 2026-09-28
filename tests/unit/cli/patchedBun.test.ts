import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import {
	PATCHED_BUN_RELEASE,
	installPatchedBun,
	parsePatchedBunChoice,
	patchedBunAsset,
	patchedBunOfferState,
	patchedBunPath,
	readPatchedBunPreference,
	readZipEntry,
	writePatchedBunPreference
} from '../../../src/cli/patchedBun';

/* A minimal zip writer: one local header + central directory entry per file,
 * so the reader is tested against real archive bytes, stored and deflated. */
const zip = (
	files: Array<{ data: Uint8Array; deflate: boolean; name: string }>
) => {
	const encoder = new TextEncoder();
	const locals: Uint8Array[] = [];
	const centrals: Uint8Array[] = [];
	let offset = 0;
	for (const file of files) {
		const name = encoder.encode(file.name);
		const body = file.deflate
			? new Uint8Array(deflateRawSync(file.data))
			: file.data;
		const local = new Uint8Array(30 + name.length + body.length);
		const lv = new DataView(local.buffer);
		lv.setUint32(0, 0x04034b50, true);
		lv.setUint16(8, file.deflate ? 8 : 0, true);
		lv.setUint32(18, body.length, true);
		lv.setUint32(22, file.data.length, true);
		lv.setUint16(26, name.length, true);
		local.set(name, 30);
		local.set(body, 30 + name.length);
		const central = new Uint8Array(46 + name.length);
		const cv = new DataView(central.buffer);
		cv.setUint32(0, 0x02014b50, true);
		cv.setUint16(10, file.deflate ? 8 : 0, true);
		cv.setUint32(20, body.length, true);
		cv.setUint32(24, file.data.length, true);
		cv.setUint16(28, name.length, true);
		cv.setUint32(42, offset, true);
		central.set(name, 46);
		locals.push(local);
		centrals.push(central);
		offset += local.length;
	}
	const directorySize = centrals.reduce((sum, part) => sum + part.length, 0);
	const end = new Uint8Array(22);
	const ev = new DataView(end.buffer);
	ev.setUint32(0, 0x06054b50, true);
	ev.setUint16(8, files.length, true);
	ev.setUint16(10, files.length, true);
	ev.setUint32(12, directorySize, true);
	ev.setUint32(16, offset, true);

	return new Uint8Array(Buffer.concat([...locals, ...centrals, end]));
};

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
	asset: 'bun-linux-x64',
	bunVersion: '1.4.0',
	ci: false,
	installed: false,
	interactive: true,
	now: new Date('2026-09-28T12:00:00Z'),
	preference: null,
	supported: false,
	usesReact: true
};

describe('patched Bun platform build', () => {
	test('names the zip the way Bun names its release', () => {
		expect(patchedBunAsset('linux', 'x64', 'glibc')).toBe('bun-linux-x64');
		expect(patchedBunAsset('linux', 'arm64', 'musl')).toBe(
			'bun-linux-aarch64-musl'
		);
		expect(patchedBunAsset('android', 'arm64', 'android')).toBe(
			'bun-linux-aarch64-android'
		);
		expect(patchedBunAsset('darwin', 'arm64', 'glibc')).toBe(
			'bun-darwin-aarch64'
		);
		expect(patchedBunAsset('win32', 'x64', 'glibc')).toBe(
			'bun-windows-x64'
		);
		expect(patchedBunAsset('freebsd', 'x64', 'glibc')).toBe(
			'bun-freebsd-x64'
		);
		expect(patchedBunAsset('sunos', 'x64', 'glibc')).toBeNull();
		expect(patchedBunAsset('linux', 'ia32', 'glibc')).toBeNull();
	});

	test('every release build has a pinned checksum', () => {
		for (const hash of Object.values(PATCHED_BUN_RELEASE.sha256))
			expect(hash).toMatch(/^[0-9a-f]{64}$/);
		expect(Object.keys(PATCHED_BUN_RELEASE.sha256)).toHaveLength(12);
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
		expect(patchedBunOfferState({ ...offerContext, asset: null })).toBe(
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
		expect(
			patchedBunOfferState({ ...offerContext, bunVersion: '1.4.1' })
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

describe('installing the patched Bun', () => {
	const binary = new TextEncoder().encode(
		'#!/bin/sh\necho patched\n'.repeat(50)
	);
	const archive = zip([
		{
			data: new TextEncoder().encode('ignored'),
			deflate: false,
			name: 'bun-linux-x64/'
		},
		{ data: binary, deflate: true, name: 'bun-linux-x64/bun' }
	]);
	const serve = (body: Uint8Array) => () =>
		Promise.resolve(new Response(body.slice()));
	const sha = (bytes: Uint8Array) =>
		new Bun.CryptoHasher('sha256').update(bytes).digest('hex');

	test('reads stored and deflated zip entries', () => {
		expect(readZipEntry(archive, 'bun-linux-x64/bun')).toEqual(binary);
		expect(readZipEntry(archive, 'bun-linux-x64/')).toEqual(
			new TextEncoder().encode('ignored')
		);
		expect(() => readZipEntry(archive, 'missing')).toThrow(
			'missing is not in the archive.'
		);
		expect(() => readZipEntry(new Uint8Array(40), 'x')).toThrow(
			'Not a zip archive.'
		);
	});

	test('installs into its own cache when the checksum matches', async () => {
		const home = tempHome();
		const path = await installPatchedBun({
			asset: 'bun-linux-x64',
			checksums: {
				...PATCHED_BUN_RELEASE.sha256,
				'bun-linux-x64': sha(archive)
			},
			fetchImpl: serve(archive) as unknown as typeof fetch,
			home,
			log: () => undefined
		});
		expect(path).toBe(patchedBunPath('bun-linux-x64', home));
		expect(
			path.startsWith(
				join(home, '.absolutejs', 'bun', PATCHED_BUN_RELEASE.tag)
			)
		).toBe(true);
		expect(new Uint8Array(readFileSync(path))).toEqual(binary);
	});

	test('refuses a download that does not match the pinned checksum', async () => {
		const home = tempHome();
		await expect(
			installPatchedBun({
				asset: 'bun-linux-x64',
				fetchImpl: serve(archive) as unknown as typeof fetch,
				home,
				log: () => undefined
			})
		).rejects.toThrow('does not match its pinned SHA-256');
		expect(existsSync(patchedBunPath('bun-linux-x64', home))).toBe(false);
	});
});
