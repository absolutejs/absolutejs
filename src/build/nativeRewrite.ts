/** Native Zig import rewriter — 15x faster than JS regex on large files.
 *  Falls back to JS if the native addon isn't available (unsupported platform,
 *  missing or unloadable binary). The load is attempted once per process and
 *  the outcome memoised, so a missing addon never re-runs `dlopen` per file;
 *  `describeNativeRewriteFallback` lets the build log the reason once. */

import { dlopen, FFIType, ptr } from 'bun:ffi';
import { platform, arch } from 'node:os';
import { resolve } from 'node:path';

const ffiDefinition = {
	rewrite_imports: {
		args: [
			FFIType.ptr,
			FFIType.u64,
			FFIType.ptr,
			FFIType.u64,
			FFIType.ptr,
			FFIType.ptr
		],
		returns: FFIType.i32
	}
} as const;

type NativeLib = ReturnType<typeof dlopen<typeof ffiDefinition>>['symbols'];

type NativeLoadState = {
	lib: NativeLib | null;
	/** Why the addon is unavailable; `null` when it loaded. */
	reason: string | null;
};

const platformMap: Record<string, string> = {
	'darwin-arm64': 'darwin-arm64/fast_ops.dylib',
	'darwin-x64': 'darwin-x64/fast_ops.dylib',
	'linux-arm64': 'linux-arm64/fast_ops.so',
	'linux-x64': 'linux-x64/fast_ops.so',
	'win32-arm64': 'windows-arm64/fast_ops.dll',
	'win32-x64': 'windows-x64/fast_ops.dll'
};

const platformKey = () => `${platform()}-${arch()}`;

let loadState: NativeLoadState | undefined;

const attemptLoad = () => {
	const libPath = platformMap[platformKey()];
	if (!libPath) {
		return { lib: null, reason: 'no prebuilt fast_ops binary' };
	}

	const fullPath = resolve(
		import.meta.dir,
		'../../native/packages',
		libPath
	);
	try {
		return { lib: dlopen(fullPath, ffiDefinition).symbols, reason: null };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);

		return { lib: null, reason: `${fullPath}: ${message}` };
	}
};

const loadNative = () => {
	loadState ??= attemptLoad();

	return loadState;
};

/** `null` when the native scanner is loaded; otherwise a one-line reason
 *  naming the platform/arch, for the build to log at warn level. */
export const describeNativeRewriteFallback = () => {
	const { reason } = loadNative();
	if (reason === null) return null;

	return `native import rewriter unavailable on ${platformKey()} (${reason}); using the JavaScript fallback`;
};

/** Rewrite import specifiers in a string using the native Zig scanner.
 *  Returns the rewritten string, or null if native isn't available. */
export const nativeRewriteImports = (
	content: string,
	replacements: [string, string][]
) => {
	const { lib } = loadNative();
	if (!lib) return null;

	// Format replacements as JSON array of [specifier, webPath] pairs
	const jsonStr = JSON.stringify(replacements);
	const contentBuf = Buffer.from(content);
	const jsonBuf = Buffer.from(jsonStr);
	const outBuf = Buffer.alloc(content.length * 2);

	// outLenPtr is a pointer to a usize (8 bytes on 64-bit)
	const outLenBuf = new BigUint64Array([BigInt(outBuf.length)]);

	const result = lib.rewrite_imports(
		ptr(contentBuf),
		contentBuf.length,
		ptr(jsonBuf),
		jsonBuf.length,
		ptr(outBuf),
		ptr(new Uint8Array(outLenBuf.buffer))
	);

	if (result < 0) return null;
	if (result === 0) return content; // no changes

	const outLen = Number(outLenBuf[0]);

	return outBuf.subarray(0, outLen).toString('utf-8');
};
