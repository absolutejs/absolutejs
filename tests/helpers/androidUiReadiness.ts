import { hasAndroidAnrDialog } from './androidUiFailure';

/** Boot completion alone does not mean Android can service UI automation. */
export const requireAndroidUiReadiness = async (
	sample: () => Promise<string>,
	wait: () => Promise<void> = () => Bun.sleep(10_000)
) => {
	for (let index = 0; index < 3; index++) {
		const xml = await sample();
		if (hasAndroidAnrDialog(xml))
			throw new Error(
				'Android startup ANR: refusing to install or test against an unhealthy emulator.'
			);
		if (
			!/<node\b[^>]*package="(?:com\.google\.android\.apps\.nexuslauncher|com\.android\.launcher3)"/u.test(
				xml
			)
		)
			throw new Error(
				'Android launcher is not ready for release UI acceptance.'
			);
		if (index < 2) await wait();
	}
};
