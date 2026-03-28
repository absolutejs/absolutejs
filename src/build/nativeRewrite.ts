/** Native Zig import rewriter — 15x faster than JS regex on large files.
 *  Falls back to JS if the native addon isn't available (Windows, missing .so). */

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

let nativeLib: NativeLib | null = null;

const loadNative = () => {
	if (nativeLib !== null) return nativeLib;

	const osPlatform = platform();
	const cpu = arch();

	const platformMap: Record<string, string> = {
		'darwin-arm64': 'darwin-arm64/fast_ops.dylib',
		'darwin-x64': 'darwin-x64/fast_ops.dylib',
		'linux-arm64': 'linux-arm64/fast_ops.so',
		'linux-x64': 'linux-x64/fast_ops.so',
		'win32-arm64': 'windows-arm64/fast_ops.dll',
		'win32-x64': 'windows-x64/fast_ops.dll'
	};

	const libPath = platformMap[`${osPlatform}-${cpu}`];
	if (!libPath) return null;

	try {
		const fullPath = resolve(
			import.meta.dir,
			'../../native/packages',
			libPath
		);
		const lib = dlopen(fullPath, ffiDefinition);
		nativeLib = lib.symbols;

		return nativeLib;
	} catch {
		return null;
	}
};

/** Rewrite import specifiers in a string using the native Zig scanner.
 *  Returns the rewritten string, or null if native isn't available. */
export const nativeRewriteImports = (
	content: string,
	replacements: [string, string][]
) => {
	const lib = loadNative();
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
