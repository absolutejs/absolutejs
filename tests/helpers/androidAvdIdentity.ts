/** Windows ADB console output may contain CR-CR-LF rather than just CR-LF. */
export const matchesAndroidAvdIdentity = (output: string, expected: string) =>
	output.split('\n')[0]?.trim() === expected;
