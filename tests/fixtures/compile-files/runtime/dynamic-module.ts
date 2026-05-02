const nestedUrl = new URL('./nested/dynamic-module.txt', import.meta.url);

export const readDynamicModuleAsset = async () =>
	(await Bun.file(nestedUrl).text()).trim();
