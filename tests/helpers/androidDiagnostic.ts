import { writeFile } from 'node:fs/promises';

/** Failed evidence capture must not replace the test error or prevent cleanup. */
export const saveAndroidDiagnostic = async (
	path: string,
	capture: () => Promise<string | Uint8Array>
) => {
	try {
		await writeFile(path, await capture());

		return true;
	} catch {
		return false;
	}
};
