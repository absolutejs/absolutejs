import {
	mkdir,
	readFile,
	readdir,
	rename,
	rm,
	writeFile
} from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { NormalizedAbsoluteMobileConfig } from './config';

const START = '// absolutejs:mobile-updates:start';
const END = '// absolutejs:mobile-updates:end';
const PLUGIN_START = '// absolutejs:mobile-update-plugin:start';
const PLUGIN_END = '// absolutejs:mobile-update-plugin:end';
const ANDROID_PLUGIN = 'AbsoluteMobileUpdateWatchdogPlugin.java';

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

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

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

const removeOwnedFile = async (path: string) => {
	if ((await optionalSource(path)) === null) return false;
	await rm(path);

	return true;
};

const replaceMarkedRegion = (
	source: string,
	start: string,
	end: string,
	region: string,
	insertion: number,
	error: string
) => {
	const existingStart = source.indexOf(start);
	const existingEnd = source.indexOf(end);
	if (
		existingStart < 0 !== existingEnd < 0 ||
		(existingStart >= 0 && existingEnd < existingStart)
	)
		throw new TypeError('AbsoluteJS mobile update markers are malformed.');
	if (existingStart >= 0) {
		const from = source.lastIndexOf('\n', existingStart) + 1;
		const newline = source.indexOf('\n', existingEnd + end.length);

		return `${source.slice(0, from)}${region}${source.slice(newline < 0 ? source.length : newline + 1)}`;
	}
	if (!region) return source;
	if (insertion < 0) throw new TypeError(error);

	return `${source.slice(0, insertion)}${region}${source.slice(insertion)}`;
};

const iosPluginRegion = (timeoutMs: number) => `${PLUGIN_START}
@objc(AbsoluteMobileUpdateWatchdogPlugin)
public final class AbsoluteMobileUpdateWatchdogPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "AbsoluteMobileUpdateWatchdogPlugin"
    public let jsName = "AbsoluteMobileUpdateWatchdog"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "arm", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "confirm", returnType: CAPPluginReturnPromise)
    ]

    private static let stateKey = "CapacitorStorage.absolute.mobile.update.state.v1"
    private static let releasePattern = try! NSRegularExpression(pattern: "^amu_[a-f0-9]{64}$")
    private var deadline: DispatchWorkItem?

    private static func state() -> [String: Any] {
        guard let encoded = UserDefaults.standard.string(forKey: stateKey),
              let data = encoded.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data),
              let value = object as? [String: Any] else { return [:] }
        return value
    }

    private static func write(_ state: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: state),
              let encoded = String(data: data, encoding: .utf8) else { return }
        UserDefaults.standard.set(encoded, forKey: stateKey)
    }

    private static func validRelease(_ value: String) -> Bool {
        releasePattern.firstMatch(in: value, range: NSRange(value.startIndex..., in: value)) != nil
    }

    private static func snapshotRoot() -> URL? {
        FileManager.default.urls(for: .libraryDirectory, in: .userDomainMask).first?
            .appendingPathComponent("NoCloud/ionic_built_snapshots", isDirectory: true)
    }

    @discardableResult
    private static func recover(_ reason: String) -> (String, String?, Bool)? {
        var value = state()
        guard let release = value["pendingRelease"] as? String, validRelease(release) else { return nil }
        let previous = value["previousPath"] as? String
        let active = value["activeRelease"] as? String
        let hasActive = active.map(validRelease) ?? false
        let started = value["pendingStartedAt"] as? Double ?? Date().timeIntervalSince1970 * 1000
        let duration = max(0, Date().timeIntervalSince1970 * 1000 - started)
        value.removeValue(forKey: "pendingRelease")
        value.removeValue(forKey: "pendingStartedAt")
        value.removeValue(forKey: "previousPath")
        value.removeValue(forKey: "readyRelease")
        var quarantined = value["quarantinedReleases"] as? [String] ?? []
        quarantined.removeAll(where: { $0 == release })
        quarantined.append(release)
        value["quarantinedReleases"] = Array(quarantined.suffix(8))
        value["recovery"] = ["durationMs": duration, "reason": reason, "releaseId": release]
        write(value)

        if hasActive, let previous, let root = snapshotRoot(),
           URL(fileURLWithPath: previous).standardizedFileURL.path.hasPrefix(root.standardizedFileURL.path + "/") {
            UserDefaults.standard.set(previous, forKey: "serverBasePath")
        } else {
            UserDefaults.standard.removeObject(forKey: "serverBasePath")
        }
        if let root = snapshotRoot() {
            try? FileManager.default.removeItem(at: root.appendingPathComponent(release, isDirectory: true))
        }

        return (release, previous, hasActive)
    }

    public static func recoverInterruptedBoot() {
        if recover("boot-interrupted") != nil { return }
        guard let persisted = UserDefaults.standard.string(forKey: "serverBasePath"),
              let root = snapshotRoot() else { return }
        let path = URL(fileURLWithPath: persisted).standardizedFileURL.path
        if path.hasPrefix(root.standardizedFileURL.path + "/") &&
           !FileManager.default.fileExists(atPath: path) {
            UserDefaults.standard.removeObject(forKey: "serverBasePath")
        }
    }

    @objc public func arm(_ call: CAPPluginCall) {
        guard let requested = call.getString("releaseId"),
              Self.validRelease(requested),
              Self.state()["pendingRelease"] as? String == requested else {
            call.reject("Mobile update watchdog cannot arm an unknown release.")
            return
        }
        deadline?.cancel()
        let work = DispatchWorkItem { [weak self] in
            guard let self, let recovery = Self.recover("boot-timeout") else { return }
            if recovery.2, let previous = recovery.1,
               let root = Self.snapshotRoot(),
               URL(fileURLWithPath: previous).standardizedFileURL.path.hasPrefix(root.standardizedFileURL.path + "/") {
                (self.bridge?.viewController as? CAPBridgeViewController)?.setServerBasePath(path: previous)
            } else if let embedded = Bundle.main.url(forResource: "public", withExtension: nil)?.path {
                (self.bridge?.viewController as? CAPBridgeViewController)?.setServerBasePath(path: embedded)
            }
        }
        deadline = work
        DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(${timeoutMs}), execute: work)
        call.resolve()
    }

    @objc public func confirm(_ call: CAPPluginCall) {
        deadline?.cancel()
        deadline = nil
        call.resolve()
    }
}
${PLUGIN_END}
`;

const configureIos = async (
	config: NormalizedAbsoluteMobileConfig,
	enabled: boolean
) => {
	const path = join(
		config.nativeProjectDirectory,
		'ios/App/App/AppDelegate.swift'
	);
	const capacitorConfigPath = join(
		config.nativeProjectDirectory,
		'ios/App/App/capacitor.config.json'
	);
	let source = await readFile(path, 'utf8');
	const launch = source.indexOf('didFinishLaunchingWithOptions');
	const brace = launch < 0 ? -1 : source.indexOf('{', launch);
	const launchRegion = enabled
		? `        ${START}\n        AbsoluteMobileUpdateWatchdogPlugin.recoverInterruptedBoot()\n        ${END}\n`
		: '';
	source = replaceMarkedRegion(
		source,
		START,
		END,
		launchRegion,
		brace < 0 ? -1 : source.indexOf('\n', brace) + 1,
		'Could not find a safe iOS location for mobile update recovery.'
	);
	const plugin = enabled
		? iosPluginRegion(config.updates?.bootTimeoutMs ?? 20_000)
		: '';
	source = replaceMarkedRegion(
		source,
		PLUGIN_START,
		PLUGIN_END,
		plugin,
		source.length,
		'Could not find a safe iOS location for the mobile update watchdog.'
	);

	const capacitorConfigSource = await readFile(capacitorConfigPath, 'utf8');
	let capacitorConfig: Record<string, unknown>;
	try {
		const value: unknown = JSON.parse(capacitorConfigSource);
		if (!isRecord(value)) throw new TypeError();
		capacitorConfig = value;
	} catch {
		throw new TypeError(
			'iOS capacitor.config.json is invalid; run Capacitor sync before projecting mobile updates.'
		);
	}
	const packageClassList = Reflect.get(capacitorConfig, 'packageClassList');
	if (!Array.isArray(packageClassList))
		throw new TypeError(
			'iOS capacitor.config.json has no packageClassList; run Capacitor sync before projecting mobile updates.'
		);
	const classes = packageClassList.filter(
		(value): value is string => typeof value === 'string'
	);
	const nextClasses = enabled
		? [...new Set([...classes, 'AbsoluteMobileUpdateWatchdogPlugin'])]
		: classes.filter(
				(value) => value !== 'AbsoluteMobileUpdateWatchdogPlugin'
			);
	const nextCapacitorConfig = `${JSON.stringify(
		{ ...capacitorConfig, packageClassList: nextClasses },
		null,
		'\t'
	)}\n`;
	const changed = await Promise.all([
		writeChanged(path, source),
		writeChanged(capacitorConfigPath, nextCapacitorConfig)
	]);

	return changed.some(Boolean);
};

const androidPluginSource = (
	packageName: string,
	timeoutMs: number
) => `package ${packageName};

import android.app.Activity;
import android.content.Context;
import android.content.SharedPreferences;
import android.os.Handler;
import android.os.Looper;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import org.json.JSONArray;
import org.json.JSONObject;

@CapacitorPlugin(name = "AbsoluteMobileUpdateWatchdog")
public final class AbsoluteMobileUpdateWatchdogPlugin extends Plugin {
    private static final String STATE_KEY = "absolute.mobile.update.state.v1";
    private static final String RELEASE_PATTERN = "^amu_[a-f0-9]{64}$";
    private final Handler handler = new Handler(Looper.getMainLooper());
    private Runnable deadline;

    private static SharedPreferences statePreferences(Context context) {
        return context.getSharedPreferences("CapacitorStorage", Activity.MODE_PRIVATE);
    }

    private static JSONObject state(Context context) {
        try {
            return new JSONObject(statePreferences(context).getString(STATE_KEY, "{}"));
        } catch (Exception ignored) {
            return new JSONObject();
        }
    }

    private static void write(Context context, JSONObject state) {
        statePreferences(context).edit().putString(STATE_KEY, state.toString()).commit();
    }

    private static File snapshotRoot(Context context) {
        return new File(context.getFilesDir(), "NoCloud/ionic_built_snapshots");
    }

    private static boolean validRelease(String release) {
        return release != null && release.matches(RELEASE_PATTERN);
    }

    private static boolean inside(File root, String path) {
        try {
            String base = root.getCanonicalPath() + File.separator;
            return new File(path).getCanonicalPath().startsWith(base);
        } catch (Exception ignored) {
            return false;
        }
    }

    private static void deleteTree(File file) {
        File[] children = file.listFiles();
        if (children != null) for (File child : children) deleteTree(child);
        file.delete();
    }

    private static Recovery recover(Context context, String reason) {
        JSONObject value = state(context);
        String release = value.optString("pendingRelease", "");
        if (!validRelease(release)) return null;
        String previous = value.optString("previousPath", "");
        boolean hasActive = validRelease(value.optString("activeRelease", ""));
        long started = value.optLong("pendingStartedAt", System.currentTimeMillis());
        long duration = Math.max(0, System.currentTimeMillis() - started);
        value.remove("pendingRelease");
        value.remove("pendingStartedAt");
        value.remove("previousPath");
        value.remove("readyRelease");
        try {
            JSONArray prior = value.optJSONArray("quarantinedReleases");
            JSONArray quarantined = new JSONArray();
            if (prior != null) {
                int start = Math.max(0, prior.length() - 7);
                for (int index = start; index < prior.length(); index++) {
                    String candidate = prior.optString(index, "");
                    if (validRelease(candidate) && !release.equals(candidate)) quarantined.put(candidate);
                }
            }
            quarantined.put(release);
            value.put("quarantinedReleases", quarantined);
            value.put("recovery", new JSONObject()
                .put("durationMs", duration)
                .put("reason", reason)
                .put("releaseId", release));
        } catch (Exception ignored) {}
        write(context, value);

        SharedPreferences webView = context.getSharedPreferences("CapWebViewSettings", Activity.MODE_PRIVATE);
        if (hasActive && inside(snapshotRoot(context), previous)) {
            webView.edit().putString("serverBasePath", previous).commit();
        } else {
            webView.edit().remove("serverBasePath").commit();
        }
        deleteTree(new File(snapshotRoot(context), release));
        return new Recovery(previous, hasActive);
    }

    public static void recoverInterruptedBoot(Context context) {
        recover(context, "boot-interrupted");
    }

    @PluginMethod
    public void arm(PluginCall call) {
        String requested = call.getString("releaseId");
        if (!validRelease(requested) || !requested.equals(state(getContext()).optString("pendingRelease", ""))) {
            call.reject("Mobile update watchdog cannot arm an unknown release.");
            return;
        }
        if (deadline != null) handler.removeCallbacks(deadline);
        deadline = () -> {
            Recovery recovery = recover(getContext(), "boot-timeout");
            if (recovery == null || bridge == null) return;
            if (recovery.hasActive && inside(snapshotRoot(getContext()), recovery.previousPath)) {
                bridge.setServerBasePath(recovery.previousPath);
            } else {
                bridge.setServerAssetPath("public");
            }
        };
        handler.postDelayed(deadline, ${timeoutMs}L);
        call.resolve(new JSObject());
    }

    @PluginMethod
    public void confirm(PluginCall call) {
        if (deadline != null) handler.removeCallbacks(deadline);
        deadline = null;
        call.resolve(new JSObject());
    }

    private static final class Recovery {
        final String previousPath;
        final boolean hasActive;
        Recovery(String previousPath, boolean hasActive) {
            this.previousPath = previousPath;
            this.hasActive = hasActive;
        }
    }
}
`;

const androidActivityInRoot = async (root: string) => {
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

const androidActivity = async (config: NormalizedAbsoluteMobileConfig) => {
	const roots = [
		join(config.nativeProjectDirectory, 'android/app/src/main/java'),
		join(config.nativeProjectDirectory, 'android/app/src/main/kotlin')
	];
	const candidates = await Promise.all(roots.map(androidActivityInRoot));
	const candidate = candidates.find((value) => value !== undefined);
	if (candidate) return candidate;
	throw new TypeError(
		'Android MainActivity.java or MainActivity.kt was not found.'
	);
};

const androidManagedRegion = (kotlin: boolean, generatedMethod: boolean) => {
	if (generatedMethod)
		return kotlin
			? `    ${START}\n    override fun onCreate(savedInstanceState: android.os.Bundle?) {\n        AbsoluteMobileUpdateWatchdogPlugin.recoverInterruptedBoot(this)\n        registerPlugin(AbsoluteMobileUpdateWatchdogPlugin::class.java)\n        super.onCreate(savedInstanceState)\n    }\n    ${END}\n`
			: `    ${START}\n    @Override\n    public void onCreate(android.os.Bundle savedInstanceState) {\n        AbsoluteMobileUpdateWatchdogPlugin.recoverInterruptedBoot(this);\n        registerPlugin(AbsoluteMobileUpdateWatchdogPlugin.class);\n        super.onCreate(savedInstanceState);\n    }\n    ${END}\n`;

	return kotlin
		? `        ${START}\n        AbsoluteMobileUpdateWatchdogPlugin.recoverInterruptedBoot(this)\n        registerPlugin(AbsoluteMobileUpdateWatchdogPlugin::class.java)\n        ${END}\n`
		: `        ${START}\n        AbsoluteMobileUpdateWatchdogPlugin.recoverInterruptedBoot(this);\n        registerPlugin(AbsoluteMobileUpdateWatchdogPlugin.class);\n        ${END}\n`;
};

const injectAndroidActivity = (source: string, enabled: boolean) => {
	const kotlin =
		/\bfun\s+onCreate\s*\(/u.test(source) ||
		source.includes('BridgeActivity()');
	const existingStart = source.indexOf(START);
	const existingEnd = source.indexOf(END);
	if (existingStart < 0 !== existingEnd < 0)
		throw new TypeError('AbsoluteJS mobile update markers are malformed.');
	if (existingStart >= 0) {
		const from = source.lastIndexOf('\n', existingStart) + 1;
		const newline = source.indexOf('\n', existingEnd + END.length);
		const through = newline < 0 ? source.length : newline + 1;
		const owned = source.slice(from, through);
		const generatedMethod = owned.includes('onCreate(');
		if (!enabled) return `${source.slice(0, from)}${source.slice(through)}`;
		const region = androidManagedRegion(kotlin, generatedMethod);

		return `${source.slice(0, from)}${region}${source.slice(through)}`;
	}
	if (!enabled) return source;
	const onCreate = kotlin
		? source.search(/\boverride\s+fun\s+onCreate\s*\([^)]*\)\s*\{/u)
		: source.search(
				/\b(?:public|protected)\s+void\s+onCreate\s*\([^)]*\)\s*\{/u
			);
	if (onCreate >= 0) {
		const brace = source.indexOf('{', onCreate);
		const insert = source.indexOf('\n', brace) + 1;
		const region = kotlin
			? `        ${START}\n        AbsoluteMobileUpdateWatchdogPlugin.recoverInterruptedBoot(this)\n        registerPlugin(AbsoluteMobileUpdateWatchdogPlugin::class.java)\n        ${END}\n`
			: `        ${START}\n        AbsoluteMobileUpdateWatchdogPlugin.recoverInterruptedBoot(this);\n        registerPlugin(AbsoluteMobileUpdateWatchdogPlugin.class);\n        ${END}\n`;

		return `${source.slice(0, insert)}${region}${source.slice(insert)}`;
	}
	const close = source.lastIndexOf('}');
	if (close < 0)
		throw new TypeError(
			'Could not find the Android MainActivity class body.'
		);
	const region = kotlin
		? `    ${START}\n    override fun onCreate(savedInstanceState: android.os.Bundle?) {\n        AbsoluteMobileUpdateWatchdogPlugin.recoverInterruptedBoot(this)\n        registerPlugin(AbsoluteMobileUpdateWatchdogPlugin::class.java)\n        super.onCreate(savedInstanceState)\n    }\n    ${END}\n`
		: `    ${START}\n    @Override\n    public void onCreate(android.os.Bundle savedInstanceState) {\n        AbsoluteMobileUpdateWatchdogPlugin.recoverInterruptedBoot(this);\n        registerPlugin(AbsoluteMobileUpdateWatchdogPlugin.class);\n        super.onCreate(savedInstanceState);\n    }\n    ${END}\n`;
	const separator = source[close - 1] === '\n' ? '' : '\n';

	return `${source.slice(0, close)}${separator}${region}${source.slice(close)}`;
};

const configureAndroid = async (
	config: NormalizedAbsoluteMobileConfig,
	enabled: boolean
) => {
	const activityPath = await androidActivity(config);
	const activity = await readFile(activityPath, 'utf8');
	const packageName = activity.match(
		/^\s*package\s+([A-Za-z0-9_.]+)\s*[;\n]/mu
	)?.[1];
	if (!packageName)
		throw new TypeError(
			'Android MainActivity package declaration was not found.'
		);
	const packagePath = packageName.replaceAll('.', '/');
	const pluginPath = join(
		config.nativeProjectDirectory,
		'android/app/src/main/java',
		packagePath,
		ANDROID_PLUGIN
	);
	const changed = await Promise.all([
		writeChanged(activityPath, injectAndroidActivity(activity, enabled)),
		enabled
			? writeChanged(
					pluginPath,
					androidPluginSource(
						packageName,
						config.updates?.bootTimeoutMs ?? 20_000
					)
				)
			: removeOwnedFile(pluginPath)
	]);

	return changed.some(Boolean);
};

export const applyAbsoluteNativeUpdates = async (
	config: NormalizedAbsoluteMobileConfig,
	platforms = config.platforms
) => {
	if (config.engine !== 'capacitor') return { changed: false };
	const enabled = config.updates !== undefined;
	const changed: boolean[] = [];
	if (platforms.includes('ios'))
		changed.push(await configureIos(config, enabled));
	if (platforms.includes('android'))
		changed.push(await configureAndroid(config, enabled));

	return { changed: changed.some(Boolean) };
};
