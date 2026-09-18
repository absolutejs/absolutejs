import { describe, expect, test } from 'bun:test';
import { runInNewContext } from 'node:vm';
import { absoluteExpoEmbeddedAssetsFiles } from '../../../src/mobile/expoEmbeddedAssets';

const files = absoluteExpoEmbeddedAssetsFiles('/project');
const source = (suffix: string) => {
	const entry = [...files].find(([path]) => path.endsWith(suffix));
	if (!entry) throw new Error(`Missing generated file: ${suffix}`);

	return entry[1];
};

describe('Expo embedded asset host generation', () => {
	test('registers the supported WebView extension idempotently and fails closed on unknown templates', () => {
		const exported: { exports?: (value: unknown) => unknown } = {};
		runInNewContext(source('withAbsoluteEmbeddedAssets.js'), {
			module: exported,
			require: () => ({
				withMainApplication: (_: unknown, mod: unknown) => mod
			})
		});
		const mod = exported.exports?.({}) as (value: {
			modResults: { language: string; contents: string };
		}) => { modResults: { contents: string } };
		const input: { modResults: { contents: string; language: string } } = {
			modResults: {
				contents: 'PackageList(this).packages.apply {\n}',
				language: 'kt'
			}
		};
		const once = mod(input).modResults.contents;
		expect(once).toContain(
			'add(expo.modules.absoluteembeddedassets.AbsoluteEmbeddedWebViewPackage())'
		);
		expect(mod(input).modResults.contents).toBe(once);
		expect(() =>
			mod({ modResults: { contents: '', language: 'java' } })
		).toThrow('Kotlin');
		expect(() =>
			mod({ modResults: { contents: 'unknown', language: 'kt' } })
		).toThrow('safely register');
	});

	test('keeps reserved asset misses offline and restricts file exposure', () => {
		const gradle = source('android/build.gradle');
		expect(gradle).toContain(
			"implementation 'com.facebook.react:react-android'"
		);
		expect(gradle).toContain("versionName '0.0.1'");
		const native = source('AbsoluteEmbeddedAssetsModule.kt');
		expect(native).toContain('RNCWebViewManager()');
		expect(native).toContain('WebViewAssetLoader.Builder()');
		expect(native).toContain('.setHttpAllowed(false)');
		expect(native).toContain('root.parentFile == parent');
		expect(native).toContain('paths.distinct().size == paths.size');
		expect(native).toContain(
			'bundles[bundle]?.get(name) ?: return empty(404'
		);
		expect(native).toContain('file.canonicalFile != file');
		expect(native).toContain(
			'loader.shouldInterceptRequest(uri) ?: empty(404'
		);
		expect(native).toContain('request.method != "GET"');
		expect(native).not.toContain('\u0000');
		expect(native).not.toContain('setWebContentsDebuggingEnabled');
	});

	test('installs an origin-scoped bridge before scripts and removes it with the view', () => {
		const native = source('AbsoluteEmbeddedAssetsModule.kt');
		expect(native).toContain('WebViewFeature.DOCUMENT_START_SCRIPT');
		expect(native).toContain('WebViewCompat.addDocumentStartJavaScript');
		expect(native).toContain('setOf("https://" + HOST)');
		expect(native).toContain('scripts.remove(view)?.remove()');
		expect(native).toContain('WebViewCompat.addWebMessageListener');
		expect(native).toContain(
			'isMainFrame && sourceOrigin.scheme == "https"'
		);
		expect(native).toContain('val url = webView.url');
		expect(native).toContain('view.webView.onMessage(data, url)');
	});
});
