import { randomUUID } from 'node:crypto';

type SnapshotAttempt = { attempt: number; output: string; path: string };
type SnapshotOptions = {
	onAttempt?: (result: SnapshotAttempt) => Promise<void>;
	wait?: () => Promise<void>;
};

/** UI Automator may exit zero without producing XML; never reuse an old dump. */
export const readAndroidUiSnapshot = async (
	device: (...args: string[]) => Promise<string>,
	options: SnapshotOptions = {}
) => {
	let lastOutput = '';
	for (let attempt = 0; attempt < 3; attempt++) {
		const path = `/data/local/tmp/absolute-ui-${randomUUID()}.xml`;
		try {
			// Both the command and UUID-derived path are harness-owned. Merge the
			// remote stderr because failed idle acquisition can still exit zero.
			lastOutput = await device('shell', `uiautomator dump ${path} 2>&1`);
			await options.onAttempt?.({ attempt, output: lastOutput, path });
			if (lastOutput.includes(`dumped to: ${path}`)) {
				const xml = await device('shell', 'cat', path);
				if (!/<hierarchy\b/u.test(xml) || !xml.includes('</hierarchy>'))
					throw new Error(
						'UI Automator produced invalid hierarchy XML'
					);

				return xml;
			}
		} finally {
			await device('shell', 'rm', '-f', path);
		}
		if (attempt < 2) await (options.wait ?? (() => Bun.sleep(1000)))();
	}
	throw new Error(
		`UI Automator did not produce a fresh snapshot after 3 attempts: ${lastOutput}`
	);
};
