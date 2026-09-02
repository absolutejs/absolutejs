import { readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { NormalizedAbsoluteMobileConfig } from './config';

const START = '// absolutejs:mobile-updates:start';
const END = '// absolutejs:mobile-updates:end';

const writeChanged = async (path: string, source: string) => {
	const current = await readFile(path, 'utf8');
	if (current === source) return false;
	const temporary = `${path}.${crypto.randomUUID()}.tmp`;
	await writeFile(temporary, source, { flag: 'wx' });
	await rename(temporary, path);

	return true;
};

const replaceRegion = (source: string, region: string) => {
	const start = source.indexOf(START);
	const end = source.indexOf(END);
	if (start < 0 !== end < 0 || end < start)
		throw new TypeError('AbsoluteJS mobile update markers are malformed.');
	if (start >= 0) {
		const from = source.lastIndexOf('\n', start) + 1;
		const newline = source.indexOf('\n', end + END.length);

		return `${source.slice(0, from)}${region}${source.slice(newline < 0 ? source.length : newline + 1)}`;
	}
	if (!region) return source;
	const launch = source.indexOf('didFinishLaunchingWithOptions');
	const brace = launch < 0 ? -1 : source.indexOf('{', launch);
	const insert = brace < 0 ? -1 : source.indexOf('\n', brace) + 1;
	if (insert <= 0)
		throw new TypeError(
			'Could not find a safe iOS location for mobile update recovery.'
		);

	return `${source.slice(0, insert)}${region}${source.slice(insert)}`;
};

const iosRecoveryRegion = `        ${START}
        // A confirmed Capacitor snapshot lives in Library/NoCloud and is not
        // restored during device migration. Clear only a dangling pointer so
        // Capacitor falls back to the store-signed embedded bundle.
        if let persisted = UserDefaults.standard.string(forKey: "serverBasePath"), !persisted.isEmpty,
           let library = FileManager.default.urls(for: .libraryDirectory, in: .userDomainMask).first {
            let snapshot = library
                .appendingPathComponent("NoCloud/ionic_built_snapshots", isDirectory: true)
                .appendingPathComponent(URL(fileURLWithPath: persisted).lastPathComponent, isDirectory: true)
            if !FileManager.default.fileExists(atPath: snapshot.path) {
                UserDefaults.standard.removeObject(forKey: "serverBasePath")
            }
        }
        ${END}
`;

export const applyAbsoluteNativeUpdates = async (
	config: NormalizedAbsoluteMobileConfig,
	platforms = config.platforms
) => {
	if (config.engine !== 'capacitor' || !platforms.includes('ios'))
		return { changed: false };
	const path = join(
		config.nativeProjectDirectory,
		'ios/App/App/AppDelegate.swift'
	);
	const source = await readFile(path, 'utf8');
	const updated = replaceRegion(
		source,
		config.updates ? iosRecoveryRegion : ''
	);

	return { changed: await writeChanged(path, updated) };
};
