import { readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { MobilePlatform } from '../../types/build';
import type { NormalizedAbsoluteMobileConfig } from './config';
import {
	absoluteDeviceNativeRequirements,
	resolveAbsoluteDeviceCapabilityPlan,
	type AbsoluteDeviceCapabilityPlan,
	type AbsoluteIosUsageDescription
} from './deviceCapabilities';

const START_MARKER = '<!-- absolutejs:device-capabilities:start -->';
const END_MARKER = '<!-- absolutejs:device-capabilities:end -->';
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

const managed = (source: string, region: string, insertion: number) => {
	const start = source.indexOf(START_MARKER);
	const end = source.indexOf(END_MARKER);
	if (
		(start === NOT_FOUND) !== (end === NOT_FOUND) ||
		(start !== NOT_FOUND && end < start)
	)
		throw new TypeError(
			'AbsoluteJS device-capability ownership markers are malformed.'
		);
	if (start !== NOT_FOUND) {
		const lineStart = source.lastIndexOf('\n', start) + 1;
		const nextLine = source.indexOf('\n', end + END_MARKER.length);
		const lineEnd = nextLine === NOT_FOUND ? source.length : nextLine + 1;

		return `${source.slice(0, lineStart)}${region}${source.slice(lineEnd)}`;
	}
	if (region.length === 0) return source;
	if (insertion === NOT_FOUND)
		throw new TypeError(
			'Could not find a safe native project location for device permissions.'
		);

	return `${source.slice(0, insertion)}${region}${source.slice(insertion)}`;
};

const IOS_KEYS: Record<AbsoluteIosUsageDescription, string> = {
	camera: 'NSCameraUsageDescription',
	'photo-library': 'NSPhotoLibraryUsageDescription',
	'photo-library-add': 'NSPhotoLibraryAddUsageDescription'
};

const iosDescription = (
	appName: string,
	purpose: AbsoluteIosUsageDescription
) => {
	if (purpose === 'camera')
		return `${appName} uses your camera when you choose to take a photo.`;
	if (purpose === 'photo-library')
		return `${appName} accesses your photo library only for photo actions you choose.`;

	return `${appName} adds to your photo library only for photo actions you choose.`;
};

const configureIos = async (
	config: NormalizedAbsoluteMobileConfig,
	plan: AbsoluteDeviceCapabilityPlan
) => {
	const path = join(config.nativeProjectDirectory, 'ios/App/App/Info.plist');
	const source = await readFile(path, 'utf8');
	const requirements = absoluteDeviceNativeRequirements(plan);
	const content = requirements.iosUsageDescriptions
		.map(
			(purpose) =>
				`\t<key>${IOS_KEYS[purpose]}</key>\n\t<string>${escapeXml(iosDescription(config.appName, purpose))}</string>`
		)
		.join('\n');
	const region = content
		? `\t${START_MARKER}\n${content}\n\t${END_MARKER}\n`
		: '';

	return writeChangedFile(
		path,
		managed(source, region, source.lastIndexOf('</dict>'))
	);
};

const configureAndroid = async (
	config: NormalizedAbsoluteMobileConfig,
	plan: AbsoluteDeviceCapabilityPlan
) => {
	const path = join(
		config.nativeProjectDirectory,
		'android/app/src/main/AndroidManifest.xml'
	);
	const source = await readFile(path, 'utf8');
	const permissions =
		absoluteDeviceNativeRequirements(plan).androidPermissions;
	const content = permissions
		.map(
			(permission) =>
				`    <uses-permission android:name="${escapeXml(permission)}" />`
		)
		.join('\n');
	const region = content
		? `    ${START_MARKER}\n${content}\n    ${END_MARKER}\n`
		: '';
	const application = source.indexOf('<application');
	const insertion =
		application === NOT_FOUND
			? NOT_FOUND
			: source.lastIndexOf('\n', application) + 1;

	return writeChangedFile(path, managed(source, region, insertion));
};

export const applyAbsoluteNativeDeviceCapabilities = async (
	projectRoot: string,
	config: NormalizedAbsoluteMobileConfig,
	platforms: readonly MobilePlatform[] = config.platforms,
	plan = resolveAbsoluteDeviceCapabilityPlan(projectRoot)
) => {
	const results = await Promise.all(
		platforms.map(async (platform) => ({
			didChange:
				platform === 'ios'
					? await configureIos(config, plan)
					: await configureAndroid(config, plan),
			platform
		}))
	);

	return {
		changed: results
			.filter(({ didChange }) => didChange)
			.map(({ platform }) => platform)
	};
};
