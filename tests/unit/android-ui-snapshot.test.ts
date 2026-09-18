import { expect, test } from 'bun:test';
import { readAndroidUiSnapshot } from '../helpers/androidUiSnapshot';

const noWait = async () => {};
test('zero-exit dump failures never read an old XML file and retries are bounded', async () => {
	const paths: string[] = [];
	let reads = 0;
	let removals = 0;
	await expect(
		readAndroidUiSnapshot(
			async (...args) => {
				if (args[1]?.startsWith('uiautomator dump ')) {
					paths.push(args[1].split(' ')[2] ?? '');

					return 'ERROR: could not get idle state';
				}
				if (args[1] === 'cat') reads++;
				if (args[1] === 'rm') removals++;

				return '<hierarchy><node text="stale" /></hierarchy>';
			},
			{ wait: noWait }
		)
	).rejects.toThrow('after 3 attempts: ERROR: could not get idle state');
	expect(reads).toBe(0);
	expect(removals).toBe(3);
	expect(new Set(paths).size).toBe(3);
	for (const path of paths)
		expect(path).toMatch(
			/^\/data\/local\/tmp\/absolute-ui-[a-f0-9-]+\.xml$/u
		);
});

test('a fresh acknowledged capture can recover after idle acquisition fails', async () => {
	let dumps = 0;
	const diagnostics: string[] = [];
	const result = await readAndroidUiSnapshot(
		async (...args) => {
			if (args[1]?.startsWith('uiautomator dump ')) {
				if (++dumps === 1) return 'ERROR: could not get idle state';

				return `UI hierchary dumped to: ${args[1].split(' ')[2]}`;
			}
			if (args[1] === 'cat')
				return '<hierarchy><node text="fresh" /></hierarchy>';

			return '';
		},
		{
			wait: noWait,
			onAttempt: async ({ output }) => {
				diagnostics.push(output);
			}
		}
	);
	expect(result).toContain('fresh');
	expect(dumps).toBe(2);
	expect(diagnostics).toHaveLength(2);
});

test('rejects malformed XML even when the dump is acknowledged', async () => {
	await expect(
		readAndroidUiSnapshot(
			async (...args) =>
				args[1]?.startsWith('uiautomator dump ')
					? `UI hierchary dumped to: ${args[1].split(' ')[2]}`
					: 'not XML',
			{ wait: noWait }
		)
	).rejects.toThrow('invalid hierarchy XML');
});
