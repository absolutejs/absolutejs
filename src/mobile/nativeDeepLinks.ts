import { readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { MobilePlatform } from '../../types/build';
import type { NormalizedAbsoluteMobileConfig } from './config';

const START_MARKER = '<!-- absolutejs:deep-links:start -->';
const END_MARKER = '<!-- absolutejs:deep-links:end -->';
// CODE_SIGN_ENTITLEMENTS resolves against SRCROOT (the directory holding
// App.xcodeproj), so this points at ios/App/App/AbsoluteJS.entitlements — the
// same directory as Info.plist. Keep it in step with the paths the entitlements
// readers and writers build from nativeProjectDirectory.
const IOS_ENTITLEMENTS = 'App/AbsoluteJS.entitlements';
const NOT_FOUND = -1;

const escapeXml = (value: string) =>
	value
		.replaceAll('&', '&amp;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&apos;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;');

const writeChangedFile = async (path: string, source: string) => {
	const current = await readFile(path, 'utf8');
	if (current === source) return false;
	const temporary = `${path}.${crypto.randomUUID()}.tmp`;
	await writeFile(temporary, source, { flag: 'wx' });
	await rename(temporary, path);

	return true;
};

const replaceManagedRegion = (
	source: string,
	region: string,
	insertAt: () => number
) => {
	const start = source.indexOf(START_MARKER);
	const end = source.indexOf(END_MARKER);
	if (
		(start === NOT_FOUND) !== (end === NOT_FOUND) ||
		(start !== NOT_FOUND && end < start)
	) {
		throw new TypeError(
			'AbsoluteJS deep-link ownership markers are malformed.'
		);
	}
	if (start !== NOT_FOUND) {
		const lineStart = source.lastIndexOf('\n', start) + 1;
		const nextLine = source.indexOf('\n', end + END_MARKER.length);
		const lineEnd = nextLine === NOT_FOUND ? source.length : nextLine + 1;

		return `${source.slice(0, lineStart)}${region}${source.slice(lineEnd)}`;
	}
	const index = insertAt();
	if (index === NOT_FOUND) {
		throw new TypeError(
			'Could not find a safe native project location for deep-link configuration.'
		);
	}

	return `${source.slice(0, index)}${region}${source.slice(index)}`;
};

const androidRegion = (config: NormalizedAbsoluteMobileConfig) => {
	const hosts = config.deepLinkHosts
		.map(
			(host) =>
				`                <data android:scheme="https" android:host="${escapeXml(host)}" />`
		)
		.join('\n');
	const customScheme = config.deepLinkScheme
		? `\n\n            <intent-filter>\n                <action android:name="android.intent.action.VIEW" />\n                <category android:name="android.intent.category.DEFAULT" />\n                <category android:name="android.intent.category.BROWSABLE" />\n                <data android:scheme="${escapeXml(config.deepLinkScheme)}" />\n            </intent-filter>`
		: '';

	return `            ${START_MARKER}\n            <intent-filter android:autoVerify="true">\n                <action android:name="android.intent.action.VIEW" />\n                <category android:name="android.intent.category.DEFAULT" />\n                <category android:name="android.intent.category.BROWSABLE" />\n${hosts}\n            </intent-filter>${customScheme}\n            ${END_MARKER}\n`;
};

const configureAndroid = async (config: NormalizedAbsoluteMobileConfig) => {
	const path = join(
		config.nativeProjectDirectory,
		'android/app/src/main/AndroidManifest.xml'
	);
	const source = await readFile(path, 'utf8');
	const mainActivity = source.indexOf('android:name=".MainActivity"');
	if (mainActivity === NOT_FOUND) {
		throw new TypeError('Android MainActivity was not found.');
	}
	const activityEnd = source.indexOf('</activity>', mainActivity);
	const updated = replaceManagedRegion(source, androidRegion(config), () =>
		activityEnd === NOT_FOUND
			? NOT_FOUND
			: source.lastIndexOf('\n', activityEnd) + 1
	);

	return writeChangedFile(path, updated);
};

const iosSchemeRegion = (scheme: string) =>
	`\t${START_MARKER}\n\t<key>CFBundleURLTypes</key>\n\t<array>\n\t\t<dict>\n\t\t\t<key>CFBundleURLName</key>\n\t\t\t<string>absolutejs</string>\n\t\t\t<key>CFBundleURLSchemes</key>\n\t\t\t<array>\n\t\t\t\t<string>${escapeXml(scheme)}</string>\n\t\t\t</array>\n\t\t</dict>\n\t</array>\n\t${END_MARKER}\n`;

const configureIosInfo = async (config: NormalizedAbsoluteMobileConfig) => {
	const path = join(config.nativeProjectDirectory, 'ios/App/App/Info.plist');
	const source = await readFile(path, 'utf8');
	const region = config.deepLinkScheme
		? iosSchemeRegion(config.deepLinkScheme)
		: `\t${START_MARKER}\n\t${END_MARKER}\n`;
	const updated = replaceManagedRegion(source, region, () =>
		source.lastIndexOf('</dict>')
	);

	return writeChangedFile(path, updated);
};

const iosEntitlementsSource = (config: NormalizedAbsoluteMobileConfig) => {
	const domains = config.deepLinkHosts
		.map((host) => `\t\t<string>applinks:${escapeXml(host)}</string>`)
		.join('\n');

	return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>com.apple.developer.associated-domains</key>
\t<array>
${domains}
\t</array>
</dict>
</plist>
`;
};

const configureIosEntitlements = async (
	config: NormalizedAbsoluteMobileConfig
) => {
	const path = join(
		config.nativeProjectDirectory,
		'ios/App/App/AbsoluteJS.entitlements'
	);
	let current = '';
	try {
		current = await readFile(path, 'utf8');
	} catch (error) {
		if (
			!(error instanceof Error) ||
			!('code' in error) ||
			error.code !== 'ENOENT'
		) {
			throw error;
		}
	}
	const source = iosEntitlementsSource(config);
	if (current === source) return false;
	const temporary = `${path}.${crypto.randomUUID()}.tmp`;
	await writeFile(temporary, source, { flag: 'wx' });
	await rename(temporary, path);

	return true;
};

const configureIosProject = async (config: NormalizedAbsoluteMobileConfig) => {
	const path = join(
		config.nativeProjectDirectory,
		'ios/App/App.xcodeproj/project.pbxproj'
	);
	const source = await readFile(path, 'utf8');
	const declarations = [
		...source.matchAll(/CODE_SIGN_ENTITLEMENTS = ([^;]+);/g)
	].map((match) => match[1]);
	if (declarations.some((value) => value !== IOS_ENTITLEMENTS)) {
		throw new TypeError(
			'The iOS target already uses a different entitlements file; merge associated domains there before continuing.'
		);
	}
	if (declarations.length > 0) return false;
	let count = 0;
	const updated = source.replaceAll(
		'INFOPLIST_FILE = App/Info.plist;',
		() => {
			count += 1;

			return `CODE_SIGN_ENTITLEMENTS = ${IOS_ENTITLEMENTS};\n\t\t\t\tINFOPLIST_FILE = App/Info.plist;`;
		}
	);
	if (count === 0) {
		throw new TypeError(
			'The iOS application target build settings were not found.'
		);
	}

	return writeChangedFile(path, updated);
};

const configureIos = async (config: NormalizedAbsoluteMobileConfig) => {
	const changed = await Promise.all([
		configureIosInfo(config),
		configureIosEntitlements(config),
		configureIosProject(config)
	]);

	return changed.some(Boolean);
};

export const applyAbsoluteNativeDeepLinks = async (
	config: NormalizedAbsoluteMobileConfig,
	platforms: readonly MobilePlatform[] = config.platforms
) => {
	const results = await Promise.all(
		platforms.map(async (platform) => {
			const didChange =
				platform === 'android'
					? await configureAndroid(config)
					: await configureIos(config);

			return { didChange, platform };
		})
	);

	return {
		changed: results
			.filter(({ didChange }) => didChange)
			.map(({ platform }) => platform)
	};
};
