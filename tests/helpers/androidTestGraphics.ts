/** Optional installed-emulator override; never change a user's AVD config. */
export const androidTestGraphicsArgs = (
	mode: string | undefined,
	disableVulkan?: string
) => {
	if (
		disableVulkan !== undefined &&
		disableVulkan !== '0' &&
		disableVulkan !== '1'
	)
		throw new Error(
			'Unsupported ABSOLUTE_TEST_RELEASE_DISABLE_VULKAN value'
		);
	if (
		mode !== undefined &&
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

	return [
		...(mode === undefined ? [] : ['-gpu', mode]),
		...(disableVulkan === '1' ? ['-feature', '-Vulkan'] : [])
	];
};
