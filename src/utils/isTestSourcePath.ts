export const isTestSourcePath = (file: string) => {
	const normalized = file.replace(/\\/g, '/');

	return (
		normalized.includes('/__tests__/') ||
		/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(normalized)
	);
};
