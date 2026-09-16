import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { NormalizedAbsoluteMobileConfig } from './config';

const START = '// absolutejs:release-readiness:start';
const END = '// absolutejs:release-readiness:end';
const IOS_PLUGIN_START = '// absolutejs:release-readiness-plugin:start';
const IOS_PLUGIN_END = '// absolutejs:release-readiness-plugin:end';
const ANDROID_PLUGIN = 'AbsoluteReleaseReadinessPlugin.java';

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

const writeChanged = async (path: string, source: string) => {
	const current = await optionalSource(path);
	if (current === source) return false;
	await mkdir(dirname(path), { recursive: true });
	if (current === null) {
		await writeFile(path, source, { flag: 'wx' });

		return true;
	}
	const temporary = `${path}.${crypto.randomUUID()}.tmp`;
	await writeFile(temporary, source, { flag: 'wx' });
	await rename(temporary, path);

	return true;
};

const activityInRoot = async (root: string) => {
	let entries: string[];
	try {
		entries = await readdir(root, { recursive: true });
	} catch (error) {
		if (
			typeof error === 'object' &&
			error !== null &&
			Reflect.get(error, 'code') === 'ENOENT'
		)
			return undefined;
		throw error;
	}
	const candidate = entries.find(
		(entry) =>
			entry.endsWith('/MainActivity.java') ||
			entry.endsWith('/MainActivity.kt') ||
			entry === 'MainActivity.java' ||
			entry === 'MainActivity.kt'
	);

	return candidate ? join(root, candidate) : undefined;
};

const activityPath = async (config: NormalizedAbsoluteMobileConfig) => {
	const roots = [
		join(config.nativeProjectDirectory, 'android/app/src/main/java'),
		join(config.nativeProjectDirectory, 'android/app/src/main/kotlin')
	];
	const candidates = await Promise.all(roots.map(activityInRoot));
	const candidate = candidates.find((value) => value !== undefined);
	if (candidate) return candidate;
	throw new TypeError(
		'Android MainActivity.java or MainActivity.kt was not found.'
	);
};

const registrationRegion = (kotlin: boolean, generatedMethod: boolean) => {
	if (generatedMethod)
		return kotlin
			? `    ${START}\n    override fun onCreate(savedInstanceState: android.os.Bundle?) {\n        registerPlugin(AbsoluteReleaseReadinessPlugin::class.java)\n        super.onCreate(savedInstanceState)\n    }\n    ${END}\n`
			: `    ${START}\n    @Override\n    public void onCreate(android.os.Bundle savedInstanceState) {\n        registerPlugin(AbsoluteReleaseReadinessPlugin.class);\n        super.onCreate(savedInstanceState);\n    }\n    ${END}\n`;

	return kotlin
		? `        ${START}\n        registerPlugin(AbsoluteReleaseReadinessPlugin::class.java)\n        ${END}\n`
		: `        ${START}\n        registerPlugin(AbsoluteReleaseReadinessPlugin.class);\n        ${END}\n`;
};

const injectRegistration = (source: string) => {
	const kotlin =
		/\bfun\s+onCreate\s*\(/u.test(source) ||
		source.includes('BridgeActivity()');
	const existingStart = source.indexOf(START);
	const existingEnd = source.indexOf(END);
	if (
		existingStart < 0 !== existingEnd < 0 ||
		(existingStart >= 0 && existingEnd < existingStart)
	)
		throw new TypeError(
			'AbsoluteJS release-readiness markers are malformed.'
		);
	if (existingStart >= 0) {
		const from = source.lastIndexOf('\n', existingStart) + 1;
		const newline = source.indexOf('\n', existingEnd + END.length);
		const through = newline < 0 ? source.length : newline + 1;
		const generatedMethod = source
			.slice(from, through)
			.includes('onCreate(');

		return `${source.slice(0, from)}${registrationRegion(kotlin, generatedMethod)}${source.slice(through)}`;
	}
	const onCreate = kotlin
		? source.search(/\boverride\s+fun\s+onCreate\s*\([^)]*\)\s*\{/u)
		: source.search(
				/\b(?:public|protected)\s+void\s+onCreate\s*\([^)]*\)\s*\{/u
			);
	if (onCreate >= 0) {
		const brace = source.indexOf('{', onCreate);
		const insert = source.indexOf('\n', brace) + 1;
		if (insert <= 0)
			throw new TypeError(
				'Could not inject Android release readiness into MainActivity.'
			);

		return `${source.slice(0, insert)}${registrationRegion(kotlin, false)}${source.slice(insert)}`;
	}
	const close = source.lastIndexOf('}');
	if (close < 0)
		throw new TypeError(
			'Could not find the Android MainActivity class body.'
		);
	const separator = source[close - 1] === '\n' ? '' : '\n';

	return `${source.slice(0, close)}${separator}${registrationRegion(kotlin, true)}${source.slice(close)}`;
};

const pluginSource = (packageName: string) => `package ${packageName};

import android.util.Log;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "AbsoluteReleaseReadiness")
public final class AbsoluteReleaseReadinessPlugin extends Plugin {
    @PluginMethod
    public void ready(PluginCall call) {
        Log.i("AbsoluteJS", "Capacitor embedded web content ready");
        call.resolve(new JSObject().put("ready", true));
    }
}
`;

const iosPluginRegion = `${IOS_PLUGIN_START}
@objc(AbsoluteReleaseReadinessPlugin)
public final class AbsoluteReleaseReadinessPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "AbsoluteReleaseReadinessPlugin"
    public let jsName = "AbsoluteReleaseReadiness"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "ready", returnType: CAPPluginReturnPromise)
    ]

    @objc public func ready(_ call: CAPPluginCall) {
		let info = Bundle.main.infoDictionary ?? [:]
		let version = info["CFBundleShortVersionString"] as? String ?? "unknown"
		let build = info["CFBundleVersion"] as? String ?? "unknown"
		NSLog("AbsoluteJS: Capacitor embedded web content ready; version=%@; build=%@", version, build)
        call.resolve(["ready": true])
    }
}
${IOS_PLUGIN_END}
`;

const replaceIosPluginRegion = (
	appDelegate: string,
	existingStart: number,
	existingEnd: number
) => {
	const from = appDelegate.lastIndexOf('\n', existingStart) + 1;
	const newline = appDelegate.indexOf(
		'\n',
		existingEnd + IOS_PLUGIN_END.length
	);
	const through = newline < 0 ? appDelegate.length : newline + 1;

	return `${appDelegate.slice(0, from)}${iosPluginRegion}${appDelegate.slice(through)}`;
};

const configureIos = async (config: NormalizedAbsoluteMobileConfig) => {
	const appDelegatePath = join(
		config.nativeProjectDirectory,
		'ios/App/App/AppDelegate.swift'
	);
	const capacitorConfigPath = join(
		config.nativeProjectDirectory,
		'ios/App/App/capacitor.config.json'
	);
	const appDelegate = await readFile(appDelegatePath, 'utf8');
	const existingStart = appDelegate.indexOf(IOS_PLUGIN_START);
	const existingEnd = appDelegate.indexOf(IOS_PLUGIN_END);
	if (
		existingStart < 0 !== existingEnd < 0 ||
		(existingStart >= 0 && existingEnd < existingStart)
	)
		throw new TypeError(
			'AbsoluteJS iOS release-readiness markers are malformed.'
		);
	const source =
		existingStart < 0
			? `${appDelegate.trimEnd()}\n\n${iosPluginRegion}`
			: replaceIosPluginRegion(appDelegate, existingStart, existingEnd);
	let capacitorConfig: unknown;
	try {
		capacitorConfig = JSON.parse(
			await readFile(capacitorConfigPath, 'utf8')
		);
	} catch {
		throw new TypeError(
			'iOS capacitor.config.json is invalid; run Capacitor sync before projecting release readiness.'
		);
	}
	if (typeof capacitorConfig !== 'object' || capacitorConfig === null)
		throw new TypeError(
			'iOS capacitor.config.json must contain an object.'
		);
	const packageClassList = Reflect.get(capacitorConfig, 'packageClassList');
	if (!Array.isArray(packageClassList))
		throw new TypeError(
			'iOS capacitor.config.json has no packageClassList; run Capacitor sync before projecting release readiness.'
		);
	const classes = packageClassList.filter(
		(value): value is string => typeof value === 'string'
	);
	const nextConfig = `${JSON.stringify(
		{
			...capacitorConfig,
			packageClassList: [
				...new Set([...classes, 'AbsoluteReleaseReadinessPlugin'])
			]
		},
		null,
		'\t'
	)}\n`;
	const changed = await Promise.all([
		writeChanged(appDelegatePath, source),
		writeChanged(capacitorConfigPath, nextConfig)
	]);

	return changed.some(Boolean);
};

const configureAndroid = async (config: NormalizedAbsoluteMobileConfig) => {
	const mainActivityPath = await activityPath(config);
	const activity = await readFile(mainActivityPath, 'utf8');
	const packageName = activity.match(
		/^\s*package\s+([A-Za-z0-9_.]+)\s*[;\n]/mu
	)?.[1];
	if (!packageName)
		throw new TypeError(
			'Android MainActivity package declaration was not found.'
		);
	const pluginPath = join(
		config.nativeProjectDirectory,
		'android/app/src/main/java',
		packageName.replaceAll('.', '/'),
		ANDROID_PLUGIN
	);
	const changed = await Promise.all([
		writeChanged(mainActivityPath, injectRegistration(activity)),
		writeChanged(pluginPath, pluginSource(packageName))
	]);

	return changed.some(Boolean);
};

/** Project a data-minimal production readiness signal into Capacitor hosts. */
export const applyAbsoluteNativeReleaseReadiness = async (
	config: NormalizedAbsoluteMobileConfig,
	platforms = config.platforms
) => {
	if (config.engine !== 'capacitor') return { changed: false };
	const changed = await Promise.all([
		platforms.includes('android') ? configureAndroid(config) : false,
		platforms.includes('ios') ? configureIos(config) : false
	]);

	return { changed: changed.some(Boolean) };
};
