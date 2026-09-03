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

const START = '// absolutejs:native-observability:start';
const END = '// absolutejs:native-observability:end';
const PLUGIN_START = '// absolutejs:native-observability-plugin:start';
const PLUGIN_END = '// absolutejs:native-observability-plugin:end';
const ANDROID_PLUGIN = 'AbsoluteMobileObservabilityPlugin.java';

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

const removeOwnedFile = async (path: string) => {
	if ((await optionalSource(path)) === null) return false;
	await rm(path);

	return true;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

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
		throw new TypeError(
			'AbsoluteJS native observability markers are malformed.'
		);
	if (existingStart >= 0) {
		const from = source.lastIndexOf('\n', existingStart) + 1;
		const newline = source.indexOf('\n', existingEnd + end.length);

		return `${source.slice(0, from)}${region}${source.slice(newline < 0 ? source.length : newline + 1)}`;
	}
	if (!region) return source;
	if (insertion < 0) throw new TypeError(error);

	return `${source.slice(0, insertion)}${region}${source.slice(insertion)}`;
};

const iosPluginRegion = `${PLUGIN_START}
@objc(AbsoluteMobileObservabilityPlugin)
public final class AbsoluteMobileObservabilityPlugin: CAPPlugin, CAPBridgedPlugin, MXMetricManagerSubscriber {
    public let identifier = "AbsoluteMobileObservabilityPlugin"
    public let jsName = "AbsoluteMobileObservability"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "acknowledge", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pending", returnType: CAPPluginReturnPromise)
    ]

    private static let maximumReports = 8
    private static let maximumReportBytes = 64 * 1024
    private static let queue = DispatchQueue(label: "dev.absolute.mobile-observability")

    public override func load() {
        MXMetricManager.shared.add(self)
    }

    deinit {
        MXMetricManager.shared.remove(self)
    }

    private static func root() -> URL? {
        guard let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first else { return nil }
        let root = support.appendingPathComponent("AbsoluteMobileObservability", isDirectory: true)
        try? FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        return root
    }

    private static func files() -> [URL] {
        guard let root = root() else { return [] }
        return ((try? FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: nil)) ?? [])
            .filter { $0.pathExtension == "json" }
            .sorted { $0.lastPathComponent < $1.lastPathComponent }
    }

    private static func trim() {
        let overflow = max(0, files().count - maximumReports)
        for file in files().prefix(overflow) { try? FileManager.default.removeItem(at: file) }
    }

    private static func enqueue(kind: String, occurredAt: Double, details: [AnyHashable: Any]) {
        guard let root = root() else { return }
        let id = UUID().uuidString.lowercased()
        var value: [String: Any] = [
            "details": Dictionary(uniqueKeysWithValues: details.map { (String(describing: $0.key), $0.value) }),
            "id": id,
            "kind": kind,
            "occurredAt": occurredAt,
            "platform": "ios"
        ]
        guard JSONSerialization.isValidJSONObject(value),
              let original = try? JSONSerialization.data(withJSONObject: value) else { return }
        if original.count > maximumReportBytes {
            value["details"] = [
                "diagnosticPrefix": String(decoding: original.prefix(24 * 1024), as: UTF8.self),
                "originalBytes": original.count,
                "truncated": true
            ]
        }
        guard let data = try? JSONSerialization.data(withJSONObject: value),
              data.count <= maximumReportBytes else { return }
        let timestamp = String(format: "%013.0f", occurredAt)
        try? data.write(to: root.appendingPathComponent("\\(timestamp)-\\(id).json"), options: .atomic)
        trim()
    }

    public func didReceive(_ payloads: [MXDiagnosticPayload]) {
        Self.queue.async {
            for payload in payloads {
                let at = payload.timeStampEnd.timeIntervalSince1970 * 1000
                for value in payload.crashDiagnostics ?? [] { Self.enqueue(kind: "crash", occurredAt: at, details: value.dictionaryRepresentation()) }
                for value in payload.hangDiagnostics ?? [] { Self.enqueue(kind: "hang", occurredAt: at, details: value.dictionaryRepresentation()) }
                for value in payload.cpuExceptionDiagnostics ?? [] { Self.enqueue(kind: "cpu-exception", occurredAt: at, details: value.dictionaryRepresentation()) }
                for value in payload.diskWriteExceptionDiagnostics ?? [] { Self.enqueue(kind: "disk-write-exception", occurredAt: at, details: value.dictionaryRepresentation()) }
                if #available(iOS 16.0, *) {
                    for value in payload.appLaunchDiagnostics ?? [] { Self.enqueue(kind: "app-launch", occurredAt: at, details: value.dictionaryRepresentation()) }
                }
            }
        }
    }

    @objc public func pending(_ call: CAPPluginCall) {
        Self.queue.async {
            let reports: [[String: Any]] = Self.files().compactMap { file in
                guard let data = try? Data(contentsOf: file),
                      let value = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
                return value
            }
            call.resolve(["reports": reports])
        }
    }

    @objc public func acknowledge(_ call: CAPPluginCall) {
        guard let ids = call.getArray("ids", String.self) else {
            call.reject("Native observability acknowledgement requires report ids.")
            return
        }
        let accepted = Set(ids)
        Self.queue.async {
            for file in Self.files() {
                guard let data = try? Data(contentsOf: file),
                      let value = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                      let id = value["id"] as? String,
                      accepted.contains(id) else { continue }
                try? FileManager.default.removeItem(at: file)
            }
            call.resolve()
        }
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
	if (enabled && !source.includes('import MetricKit')) {
		const capacitorImport = source.lastIndexOf('import Capacitor');
		if (capacitorImport < 0)
			throw new TypeError('Capacitor AppDelegate import was not found.');
		const newline = source.indexOf('\n', capacitorImport);
		source = `${source.slice(0, newline + 1)}import MetricKit\n${source.slice(newline + 1)}`;
	}
	if (!enabled) source = source.replace('import MetricKit\n', '');
	source = replaceMarkedRegion(
		source,
		PLUGIN_START,
		PLUGIN_END,
		enabled ? iosPluginRegion : '',
		source.length,
		'Could not find a safe iOS location for native observability.'
	);

	const capacitorConfigSource = await readFile(capacitorConfigPath, 'utf8');
	let capacitorConfig: Record<string, unknown>;
	try {
		const value: unknown = JSON.parse(capacitorConfigSource);
		if (!isRecord(value)) throw new TypeError();
		capacitorConfig = value;
	} catch {
		throw new TypeError(
			'iOS capacitor.config.json is invalid; run Capacitor sync before projecting native observability.'
		);
	}
	const packageClassList = Reflect.get(capacitorConfig, 'packageClassList');
	if (!Array.isArray(packageClassList))
		throw new TypeError(
			'iOS capacitor.config.json has no packageClassList; run Capacitor sync before projecting native observability.'
		);
	const classes = packageClassList.filter(
		(value): value is string => typeof value === 'string'
	);
	const nextClasses = enabled
		? [...new Set([...classes, 'AbsoluteMobileObservabilityPlugin'])]
		: classes.filter(
				(value) => value !== 'AbsoluteMobileObservabilityPlugin'
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

const androidPluginSource = (packageName: string) => `package ${packageName};

import android.app.ActivityManager;
import android.app.ApplicationExitInfo;
import android.os.Build;
import android.util.Base64;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import org.json.JSONArray;
import org.json.JSONObject;

@CapacitorPlugin(name = "AbsoluteMobileObservability")
public final class AbsoluteMobileObservabilityPlugin extends Plugin {
    private static final int MAX_REPORTS = 8;
    private static final int MAX_TRACE_BYTES = 32 * 1024;
    private static final String ACKNOWLEDGED_KEY = "acknowledged";
    private static final String PREFERENCES = "AbsoluteMobileObservability";

    private File root() {
        File value = new File(getContext().getFilesDir(), "absolute-mobile-observability");
        value.mkdirs();
        return value;
    }

    private Set<String> acknowledged() {
        Set<String> result = new HashSet<>();
        try {
            JSONArray values = new JSONArray(getContext().getSharedPreferences(PREFERENCES, 0).getString(ACKNOWLEDGED_KEY, "[]"));
            for (int index = 0; index < values.length(); index++) result.add(values.optString(index));
        } catch (Exception ignored) {}
        return result;
    }

    private void writeAcknowledged(Set<String> values) {
        List<String> sorted = new ArrayList<>(values);
        sorted.sort(String::compareTo);
        if (sorted.size() > 64) sorted = sorted.subList(sorted.size() - 64, sorted.size());
        getContext().getSharedPreferences(PREFERENCES, 0).edit().putString(ACKNOWLEDGED_KEY, new JSONArray(sorted).toString()).apply();
    }

    private static String kind(int reason) {
        if (reason == ApplicationExitInfo.REASON_ANR) return "anr";
        if (reason == ApplicationExitInfo.REASON_CRASH) return "crash";
        if (reason == ApplicationExitInfo.REASON_CRASH_NATIVE) return "native-crash";
        if (reason == ApplicationExitInfo.REASON_LOW_MEMORY) return "low-memory";
        if (reason == ApplicationExitInfo.REASON_EXCESSIVE_RESOURCE_USAGE) return "resource-exhaustion";
        if (reason == ApplicationExitInfo.REASON_INITIALIZATION_FAILURE) return "initialization-failure";
        if (reason == ApplicationExitInfo.REASON_SIGNALED) return "signal";
        return null;
    }

    private static byte[] trace(ApplicationExitInfo info) {
        try (InputStream input = info.getTraceInputStream(); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            if (input == null) return null;
            byte[] buffer = new byte[4096];
            int total = 0;
            int read;
            while ((read = input.read(buffer, 0, Math.min(buffer.length, MAX_TRACE_BYTES + 1 - total))) > 0) {
                output.write(buffer, 0, read);
                total += read;
                if (total > MAX_TRACE_BYTES) return null;
            }
            return output.toByteArray();
        } catch (Exception ignored) {
            return null;
        }
    }

    private static JSONObject report(ApplicationExitInfo info) {
        String kind = kind(info.getReason());
        if (kind == null) return null;
        String id = "android:" + info.getTimestamp() + ":" + info.getReason() + ":" + info.getStatus();
        JSONObject details = new JSONObject();
        try {
            details.put("importance", info.getImportance());
            details.put("pssKb", info.getPss());
            details.put("reason", info.getReason());
            details.put("rssKb", info.getRss());
            details.put("status", info.getStatus());
            String description = info.getDescription();
            if (description != null) details.put("description", description);
            byte[] trace = trace(info);
            if (trace != null && trace.length > 0) {
                if (info.getReason() == ApplicationExitInfo.REASON_CRASH_NATIVE) {
                    details.put("trace", Base64.encodeToString(trace, Base64.NO_WRAP));
                    details.put("traceEncoding", "android-tombstone-protobuf-base64");
                } else {
                    details.put("trace", new String(trace, StandardCharsets.UTF_8));
                    details.put("traceEncoding", "utf-8");
                }
            }
            return new JSONObject()
                .put("details", details)
                .put("id", id)
                .put("kind", kind)
                .put("occurredAt", info.getTimestamp())
                .put("platform", "android");
        } catch (Exception ignored) {
            return null;
        }
    }

    private Set<String> queuedIds() {
        Set<String> ids = new HashSet<>();
        for (File file : files()) {
            try (InputStream input = new FileInputStream(file)) {
                JSONObject report = new JSONObject(new String(read(input), StandardCharsets.UTF_8));
                ids.add(report.optString("id"));
            } catch (Exception ignored) {}
        }
        return ids;
    }

    private File[] files() {
        File[] values = root().listFiles((directory, name) -> name.endsWith(".json"));
        if (values == null) return new File[0];
        java.util.Arrays.sort(values, java.util.Comparator.comparing(File::getName));
        return values;
    }

    private static byte[] read(InputStream input) throws java.io.IOException {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        byte[] buffer = new byte[4096];
        int count;
        while ((count = input.read(buffer)) >= 0) output.write(buffer, 0, count);
        return output.toByteArray();
    }

    private void collect() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return;
        ActivityManager manager = getContext().getSystemService(ActivityManager.class);
        if (manager == null) return;
        Set<String> ignored = acknowledged();
        ignored.addAll(queuedIds());
        List<ApplicationExitInfo> exits = manager.getHistoricalProcessExitReasons(null, 0, 16);
        for (ApplicationExitInfo exit : exits) {
            JSONObject report = report(exit);
            if (report == null || ignored.contains(report.optString("id"))) continue;
            String name = String.format(java.util.Locale.ROOT, "%013d-%s.json", exit.getTimestamp(), java.util.UUID.randomUUID());
            File target = new File(root(), name);
            try (FileOutputStream output = new FileOutputStream(target)) {
                output.write(report.toString().getBytes(StandardCharsets.UTF_8));
                ignored.add(report.optString("id"));
            } catch (Exception ignoredWrite) {}
        }
        File[] files = files();
        for (int index = 0; index < files.length - MAX_REPORTS; index++) files[index].delete();
    }

    @PluginMethod
    public void pending(PluginCall call) {
        collect();
        JSArray reports = new JSArray();
        for (File file : files()) {
            try (InputStream input = new FileInputStream(file)) {
                reports.put(new JSONObject(new String(read(input), StandardCharsets.UTF_8)));
            } catch (Exception ignored) {}
        }
        call.resolve(new JSObject().put("reports", reports));
    }

    @PluginMethod
    public void acknowledge(PluginCall call) {
        JSArray ids = call.getArray("ids");
        if (ids == null) {
            call.reject("Native observability acknowledgement requires report ids.");
            return;
        }
        Set<String> accepted = new HashSet<>();
        for (int index = 0; index < ids.length(); index++) accepted.add(ids.optString(index));
        Set<String> acknowledged = acknowledged();
        for (File file : files()) {
            try (InputStream input = new FileInputStream(file)) {
                JSONObject report = new JSONObject(new String(read(input), StandardCharsets.UTF_8));
                String id = report.optString("id");
                if (accepted.contains(id)) {
                    acknowledged.add(id);
                    file.delete();
                }
            } catch (Exception ignored) {}
        }
        writeAcknowledged(acknowledged);
        call.resolve();
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

const androidRegion = (kotlin: boolean, generatedMethod: boolean) => {
	if (generatedMethod)
		return kotlin
			? `    ${START}\n    override fun onCreate(savedInstanceState: android.os.Bundle?) {\n        registerPlugin(AbsoluteMobileObservabilityPlugin::class.java)\n        super.onCreate(savedInstanceState)\n    }\n    ${END}\n`
			: `    ${START}\n    @Override\n    public void onCreate(android.os.Bundle savedInstanceState) {\n        registerPlugin(AbsoluteMobileObservabilityPlugin.class);\n        super.onCreate(savedInstanceState);\n    }\n    ${END}\n`;

	return kotlin
		? `        ${START}\n        registerPlugin(AbsoluteMobileObservabilityPlugin::class.java)\n        ${END}\n`
		: `        ${START}\n        registerPlugin(AbsoluteMobileObservabilityPlugin.class);\n        ${END}\n`;
};

const injectAndroidActivity = (source: string, enabled: boolean) => {
	const kotlin =
		/\bfun\s+onCreate\s*\(/u.test(source) ||
		source.includes('BridgeActivity()');
	const existingStart = source.indexOf(START);
	const existingEnd = source.indexOf(END);
	if (existingStart < 0 !== existingEnd < 0)
		throw new TypeError(
			'AbsoluteJS native observability markers are malformed.'
		);
	if (existingStart >= 0) {
		const from = source.lastIndexOf('\n', existingStart) + 1;
		const newline = source.indexOf('\n', existingEnd + END.length);
		const through = newline < 0 ? source.length : newline + 1;
		const generatedMethod = source
			.slice(from, through)
			.includes('onCreate(');
		if (!enabled) return `${source.slice(0, from)}${source.slice(through)}`;

		return `${source.slice(0, from)}${androidRegion(kotlin, generatedMethod)}${source.slice(through)}`;
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

		return `${source.slice(0, insert)}${androidRegion(kotlin, false)}${source.slice(insert)}`;
	}
	const close = source.lastIndexOf('}');
	if (close < 0)
		throw new TypeError(
			'Could not find the Android MainActivity class body.'
		);
	const separator = source[close - 1] === '\n' ? '' : '\n';

	return `${source.slice(0, close)}${separator}${androidRegion(kotlin, true)}${source.slice(close)}`;
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
	const pluginPath = join(
		config.nativeProjectDirectory,
		'android/app/src/main/java',
		packageName.replaceAll('.', '/'),
		ANDROID_PLUGIN
	);
	const changed = await Promise.all([
		writeChanged(activityPath, injectAndroidActivity(activity, enabled)),
		enabled
			? writeChanged(pluginPath, androidPluginSource(packageName))
			: removeOwnedFile(pluginPath)
	]);

	return changed.some(Boolean);
};

export const applyAbsoluteNativeObservability = async (
	config: NormalizedAbsoluteMobileConfig,
	platforms = config.platforms
) => {
	if (config.engine !== 'capacitor') return { changed: false };
	const enabled = config.observability !== undefined;
	const changed: boolean[] = [];
	if (platforms.includes('ios'))
		changed.push(await configureIos(config, enabled));
	if (platforms.includes('android'))
		changed.push(await configureAndroid(config, enabled));

	return { changed: changed.some(Boolean) };
};
