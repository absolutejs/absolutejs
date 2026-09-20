// Diagnostic harness only; this does not change product emulator defaults.
export const androidTestCores = (value: string | undefined): number => {
	if (value === undefined) return 4;
	if (value === '1' || value === '4') return Number(value);
	throw new Error('Android diagnostic cores must be 1 or 4');
};
