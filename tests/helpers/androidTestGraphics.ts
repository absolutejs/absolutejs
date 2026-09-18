/** Optional installed-emulator override; never change a user's AVD config. */
export const androidTestGraphicsArgs = (mode: string | undefined) => {
	if (mode === undefined) return [];
	if (
		![
			'auto',
			'host',
			'software',
			'lavapipe',
			'swiftshader',
			'swangle'
		].includes(mode)
	)
		throw new Error('Unsupported ABSOLUTE_TEST_RELEASE_GPU mode');

	return ['-gpu', mode];
};
