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
const IOS_PRIVACY_FILE_REFERENCE = 'A85D0C000000000000000001';
const IOS_PRIVACY_BUILD_FILE = 'A85D0C000000000000000002';

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

const optionalSource = async (path: string) => {
	try {
		return await readFile(path, 'utf8');
	} catch (error) {
		if (
			typeof error === 'object' &&
			error !== null &&
			Reflect.get(error, 'code') === 'ENOENT'
		)
			return null;
		throw error;
	}
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
	'location-always': 'NSLocationAlwaysAndWhenInUseUsageDescription',
	'location-when-in-use': 'NSLocationWhenInUseUsageDescription',
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
	if (purpose === 'location-when-in-use')
		return `${appName} uses your location only while you are using the app and request a location-based action.`;
	if (purpose === 'location-always')
		return `${appName} does not track location in the background; this description supports the foreground location provider required by the native runtime.`;

	return `${appName} adds to your photo library only for photo actions you choose.`;
};

const privacyEntries = (
	requirements: ReturnType<typeof absoluteDeviceNativeRequirements>
) =>
	requirements.iosPrivacyAccessedApis
		.map(
			({ api, reasons }) =>
				`		<dict>\n			<key>NSPrivacyAccessedAPIType</key>\n			<string>${escapeXml(api)}</string>\n			<key>NSPrivacyAccessedAPITypeReasons</key>\n			<array>\n${reasons
					.map((reason) => `				<string>${escapeXml(reason)}</string>`)
					.join('\n')}\n			</array>\n		</dict>`
		)
		.join('\n');

const privacyManifestSource = (
	source: string | null,
	requirements: ReturnType<typeof absoluteDeviceNativeRequirements>
) => {
	const entries = privacyEntries(requirements);
	const wholeRegion = entries
		? `	${START_MARKER}\n	<key>NSPrivacyAccessedAPITypes</key>\n	<array>\n${entries}\n	</array>\n	${END_MARKER}\n`
		: '';
	if (source === null)
		return entries
			? `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n<dict>\n${wholeRegion}	<key>NSPrivacyCollectedDataTypes</key>\n	<array/>\n	<key>NSPrivacyTracking</key>\n	<false/>\n</dict>\n</plist>\n`
			: null;

	const start = source.indexOf(START_MARKER);
	if (start !== NOT_FOUND) {
		const end = source.indexOf(END_MARKER);
		if (end === NOT_FOUND)
			throw new TypeError(
				'AbsoluteJS device-capability ownership markers are malformed.'
			);
		const owned = source.slice(start, end);
		const ownsWholeKey = owned.includes('NSPrivacyAccessedAPITypes');
		let region = '';
		if (ownsWholeKey) region = wholeRegion;
		else if (entries)
			region = `		${START_MARKER}\n${entries}\n		${END_MARKER}\n`;

		return managed(source, region, source.lastIndexOf('</dict>'));
	}

	const key = source.indexOf('<key>NSPrivacyAccessedAPITypes</key>');
	if (key === NOT_FOUND)
		return managed(source, wholeRegion, source.lastIndexOf('</dict>'));
	if (!entries) return source;
	const array = source.indexOf('<array>', key);
	if (array === NOT_FOUND)
		throw new TypeError(
			'iOS PrivacyInfo.xcprivacy has a malformed NSPrivacyAccessedAPITypes value.'
		);
	const insertion = source.indexOf('\n', array);
	if (insertion === NOT_FOUND)
		throw new TypeError('iOS PrivacyInfo.xcprivacy array is malformed.');

	return managed(
		source,
		`		${START_MARKER}\n${entries}\n		${END_MARKER}\n`,
		insertion + 1
	);
};

const writeIosPrivacyManifest = async (
	path: string,
	current: string | null,
	source: string | null
) => {
	if (source === null) return false;
	if (current !== null) return writeChangedFile(path, source);
	await writeFile(path, source, { flag: 'wx' });

	return true;
};

const configureIosPrivacyProject = async (
	config: NormalizedAbsoluteMobileConfig,
	requirements: ReturnType<typeof absoluteDeviceNativeRequirements>
) => {
	if (requirements.iosPrivacyAccessedApis.length === 0) return false;
	const projectPath = join(
		config.nativeProjectDirectory,
		'ios/App/App.xcodeproj/project.pbxproj'
	);
	const project = await readFile(projectPath, 'utf8');

	return writeChangedFile(
		projectPath,
		addIosPrivacyProjectReference(project)
	);
};

const addIosPrivacyProjectReference = (source: string) => {
	const fileMatch = source.match(
		/([A-F0-9]{24}) \/\* PrivacyInfo\.xcprivacy \*\/ = \{isa = PBXFileReference;/u
	);
	const fileReference = fileMatch?.[1] ?? IOS_PRIVACY_FILE_REFERENCE;
	const buildMatch = source.match(
		/([A-F0-9]{24}) \/\* PrivacyInfo\.xcprivacy in Resources \*\/ = \{isa = PBXBuildFile;/u
	);
	const buildFile = buildMatch?.[1] ?? IOS_PRIVACY_BUILD_FILE;
	if (
		(!fileMatch && source.includes(fileReference)) ||
		(!buildMatch && source.includes(buildFile))
	)
		throw new TypeError(
			'AbsoluteJS iOS privacy-manifest identifiers collide.'
		);

	let next = source;
	if (!buildMatch) {
		const marker = '/* End PBXBuildFile section */';
		const index = next.indexOf(marker);
		if (index === NOT_FOUND)
			throw new TypeError('Could not find the iOS PBXBuildFile section.');
		next = `${next.slice(0, index)}		${buildFile} /* PrivacyInfo.xcprivacy in Resources */ = {isa = PBXBuildFile; fileRef = ${fileReference} /* PrivacyInfo.xcprivacy */; };\n${next.slice(index)}`;
	}
	if (!fileMatch) {
		const marker = '/* End PBXFileReference section */';
		const index = next.indexOf(marker);
		if (index === NOT_FOUND)
			throw new TypeError(
				'Could not find the iOS PBXFileReference section.'
			);
		next = `${next.slice(0, index)}		${fileReference} /* PrivacyInfo.xcprivacy */ = {isa = PBXFileReference; lastKnownFileType = text.xml; path = PrivacyInfo.xcprivacy; sourceTree = "<group>"; };\n${next.slice(index)}`;
	}
	const groupsStart = next.indexOf('/* Begin PBXGroup section */');
	const groupsEnd = next.indexOf('/* End PBXGroup section */');
	const groups = next.slice(groupsStart, groupsEnd);
	if (!groups.includes(`${fileReference} /* PrivacyInfo.xcprivacy */`)) {
		const appGroup = groups.match(
			/[A-F0-9]{24} \/\* App \*\/ = \{\n\t\t\tisa = PBXGroup;\n\t\t\tchildren = \(\n/u
		);
		if (!appGroup || appGroup.index === undefined)
			throw new TypeError('Could not find the iOS App PBXGroup.');
		const index = groupsStart + appGroup.index + appGroup[0].length;
		next = `${next.slice(0, index)}				${fileReference} /* PrivacyInfo.xcprivacy */,\n${next.slice(index)}`;
	}
	const resourcesStart = next.indexOf(
		'/* Begin PBXResourcesBuildPhase section */'
	);
	const resourcesEnd = next.indexOf(
		'/* End PBXResourcesBuildPhase section */'
	);
	const resources = next.slice(resourcesStart, resourcesEnd);
	if (
		!resources.includes(
			`${buildFile} /* PrivacyInfo.xcprivacy in Resources */`
		)
	) {
		const files = resources.match(
			/isa = PBXResourcesBuildPhase;\n\t\t\tbuildActionMask = \d+;\n\t\t\tfiles = \(\n/u
		);
		if (!files || files.index === undefined)
			throw new TypeError(
				'Could not find the iOS Resources build phase.'
			);
		const index = resourcesStart + files.index + files[0].length;
		next = `${next.slice(0, index)}				${buildFile} /* PrivacyInfo.xcprivacy in Resources */,\n${next.slice(index)}`;
	}

	return next;
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

	const infoChanged = await writeChangedFile(
		path,
		managed(source, region, source.lastIndexOf('</dict>'))
	);
	const privacyPath = join(
		config.nativeProjectDirectory,
		'ios/App/App/PrivacyInfo.xcprivacy'
	);
	const privacyCurrent = await optionalSource(privacyPath);
	const privacySource = privacyManifestSource(privacyCurrent, requirements);
	const [privacyChanged, projectChanged] = await Promise.all([
		writeIosPrivacyManifest(privacyPath, privacyCurrent, privacySource),
		configureIosPrivacyProject(config, requirements)
	]);

	return infoChanged || privacyChanged || projectChanged;
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
