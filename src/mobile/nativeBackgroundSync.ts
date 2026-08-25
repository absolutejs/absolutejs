import { readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { NormalizedAbsoluteMobileConfig } from './config';
import { projectUsesAbsoluteAuth, projectUsesAbsoluteSync } from './nativeAuth';

const writeChanged = async (path: string, source: string) => {
	const current = await readFile(path, 'utf8');
	if (current === source) return false;
	const temporary = `${path}.${crypto.randomUUID()}.tmp`;
	await writeFile(temporary, source, { flag: 'wx' });
	await rename(temporary, path);

	return true;
};

const replaceRegion = (
	source: string,
	start: string,
	end: string,
	region: string,
	insert: number
) => {
	const existingStart = source.indexOf(start);
	const existingEnd = source.indexOf(end);
	if (existingStart < 0 !== existingEnd < 0 || existingEnd < existingStart)
		throw new TypeError(
			'AbsoluteJS background Sync markers are malformed.'
		);
	if (existingStart >= 0) {
		const from = source.lastIndexOf('\n', existingStart) + 1;
		const newline = source.indexOf('\n', existingEnd + end.length);

		return `${source.slice(0, from)}${region}${source.slice(newline < 0 ? source.length : newline + 1)}`;
	}
	if (insert < 0)
		throw new TypeError(
			'Could not find a safe iOS location for background Sync.'
		);

	return `${source.slice(0, insert)}${region}${source.slice(insert)}`;
};

const ensurePlistArrayValues = (
	source: string,
	key: string,
	values: string[],
	marker: string
) => {
	const start = `<!-- absolutejs:${marker}:start -->`;
	const end = `<!-- absolutejs:${marker}:end -->`;
	const makeRegion = (owned: string[]) => {
		if (owned.length === 0) return '';
		const entries = owned
			.map((value) => `\t\t<string>${value}</string>`)
			.join('\n');

		return `\t\t${start}\n${entries}\n\t\t${end}\n`;
	};
	const existingStart = source.indexOf(start);
	const existingEnd = source.indexOf(end);
	if (existingStart < 0 !== existingEnd < 0 || existingEnd < existingStart)
		throw new TypeError(
			'AbsoluteJS background Sync plist markers are malformed.'
		);
	if (existingStart >= 0) {
		const from = source.lastIndexOf('\n', existingStart) + 1;
		const newline = source.indexOf('\n', existingEnd + end.length);
		const through = newline < 0 ? source.length : newline + 1;
		const unmanaged = `${source.slice(0, from)}${source.slice(through)}`;
		const owned = values.filter(
			(value) => !unmanaged.includes(`<string>${value}</string>`)
		);

		return `${source.slice(0, from)}${makeRegion(owned)}${source.slice(through)}`;
	}

	const keyToken = `<key>${key}</key>`;
	const keyIndex = source.indexOf(keyToken);
	if (keyIndex >= 0) {
		if (source.indexOf(keyToken, keyIndex + keyToken.length) >= 0)
			throw new TypeError(
				`iOS Info.plist contains duplicate ${key} keys.`
			);
		const arrayStart = source.indexOf(
			'<array>',
			keyIndex + keyToken.length
		);
		const nextKey = source.indexOf('<key>', keyIndex + keyToken.length);
		if (arrayStart < 0 || (nextKey >= 0 && nextKey < arrayStart))
			throw new TypeError(`iOS Info.plist ${key} is not an array.`);
		const arrayEnd = source.indexOf('</array>', arrayStart);
		if (arrayEnd < 0)
			throw new TypeError(`iOS Info.plist ${key} array is malformed.`);
		const insert = source.lastIndexOf('\n', arrayEnd) + 1;
		const array = source.slice(arrayStart, arrayEnd);
		const owned = values.filter(
			(value) => !array.includes(`<string>${value}</string>`)
		);
		if (owned.length === 0) return source;

		return `${source.slice(0, insert)}${makeRegion(owned)}${source.slice(insert)}`;
	}

	const dictEnd = source.lastIndexOf('</dict>');
	if (dictEnd < 0)
		throw new TypeError(
			'Could not find the iOS Info.plist root dictionary.'
		);
	const declaration = `\t<key>${key}</key>\n\t<array>\n${makeRegion(values)}\t</array>\n`;

	return `${source.slice(0, dictEnd)}${declaration}${source.slice(dictEnd)}`;
};

export const applyAbsoluteNativeBackgroundSync = async (
	projectRoot: string,
	config: NormalizedAbsoluteMobileConfig,
	platforms = config.platforms
) => {
	if (
		!platforms.includes('ios') ||
		!projectUsesAbsoluteAuth(projectRoot) ||
		!projectUsesAbsoluteSync(projectRoot)
	)
		return { changed: false };
	const identifier = `${config.appId}.absolutejs.background-sync`;
	const infoPath = join(
		config.nativeProjectDirectory,
		'ios/App/App/Info.plist'
	);
	const info = await readFile(infoPath, 'utf8');
	const nextInfo = ensurePlistArrayValues(
		ensurePlistArrayValues(
			info,
			'BGTaskSchedulerPermittedIdentifiers',
			[identifier],
			'background-sync-identifiers'
		),
		'UIBackgroundModes',
		['fetch', 'processing'],
		'background-sync-modes'
	);

	const delegatePath = join(
		config.nativeProjectDirectory,
		'ios/App/App/AppDelegate.swift'
	);
	let delegate = await readFile(delegatePath, 'utf8');
	if (!delegate.includes('import AbsoluteSyncCapacitor')) {
		const importIndex = delegate.lastIndexOf('import Capacitor');
		if (importIndex < 0)
			throw new TypeError('Capacitor AppDelegate import was not found.');
		const end = delegate.indexOf('\n', importIndex);
		delegate = `${delegate.slice(0, end + 1)}import AbsoluteSyncCapacitor\n${delegate.slice(end + 1)}`;
	}
	const swiftStart = '// absolutejs:background-sync:start';
	const swiftEnd = '// absolutejs:background-sync:end';
	const swiftRegion = `        ${swiftStart}\n        AbsoluteBackgroundSyncPlugin.registerBackgroundTask()\n        ${swiftEnd}\n`;
	const launch = delegate.indexOf('didFinishLaunchingWithOptions');
	const brace = launch < 0 ? -1 : delegate.indexOf('{', launch);
	const nextDelegate = replaceRegion(
		delegate,
		swiftStart,
		swiftEnd,
		swiftRegion,
		brace < 0 ? -1 : delegate.indexOf('\n', brace) + 1
	);
	const changed = await Promise.all([
		writeChanged(infoPath, nextInfo),
		writeChanged(delegatePath, nextDelegate)
	]);

	return { changed: changed.some(Boolean) };
};
