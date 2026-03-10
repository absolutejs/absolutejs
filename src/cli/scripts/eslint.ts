export const eslint = async (args: string[]) => {
	const command = [
		'bun',
		'eslint',
		'--cache',
		'--cache-location',
		'.absolutejs/eslint-cache',
		...args,
		'.'
	];

	const proc = Bun.spawn(command, {
		stderr: 'inherit',
		stdout: 'inherit'
	});
	const exitCode = await proc.exited;

	if (exitCode !== 0) process.exit(exitCode);

	console.log('\x1b[32m✓\x1b[0m Passed');
};
