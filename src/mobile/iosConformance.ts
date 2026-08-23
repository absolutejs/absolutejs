import { readFile, stat } from 'node:fs/promises';

const HMR_LINE = new RegExp(
	String.raw`\[hmr:ios\]\s+([^\n]*?)\s+(applied in|falling back to reload after|failed after)\s+(\d+)ms(?:; server\s+(\d+)ms, client\s+(\d+)ms)?`,
	'u'
);

export type AbsoluteIosHmrApply = {
	clientMs?: number;
	duration: number;
	line: string;
	outcome: 'applied' | 'failed' | 'reloaded';
	serverMs?: number;
};

export const parseAbsoluteIosHmrLog = (
	line: string
): AbsoluteIosHmrApply | null => {
	const match = HMR_LINE.exec(line);
	if (!match) return null;
	const [, , action, durationValue, serverValue, clientValue] = match;
	let outcome: AbsoluteIosHmrApply['outcome'] = 'reloaded';
	if (action === 'applied in') outcome = 'applied';
	if (action === 'failed after') outcome = 'failed';
	const serverMs =
		serverValue === undefined ? undefined : Number(serverValue);
	const clientMs =
		clientValue === undefined ? undefined : Number(clientValue);

	return {
		...(clientMs === undefined ? {} : { clientMs }),
		duration: Number(durationValue),
		line: match[0],
		outcome,
		...(serverMs === undefined ? {} : { serverMs })
	};
};

const findHmrApply = (lines: string[]) => {
	const apply = lines
		.map((line) => parseAbsoluteIosHmrLog(line))
		.find((candidate) => candidate !== null);
	if (apply?.outcome === 'failed')
		throw new Error(
			`iOS HMR client reported a failed apply: ${apply.line}`
		);

	return apply;
};

export const waitForAbsoluteIosHmrLog = async (options: {
	logPath: string;
	signal?: AbortSignal;
	sleep?: (milliseconds: number) => Promise<void>;
	startOffset?: number;
	timeoutMs?: number;
}) => {
	const sleep = options.sleep ?? Bun.sleep;
	const timeoutMs = options.timeoutMs ?? 30_000;
	const deadline = Date.now() + timeoutMs;
	let offset =
		options.startOffset ??
		(await stat(options.logPath)
			.then(({ size }) => size)
			.catch(() => 0));
	let buffered = '';
	const poll = async (): Promise<AbsoluteIosHmrApply> => {
		if (Date.now() > deadline)
			throw new Error(
				`No iOS native HMR acknowledgement was observed within ${timeoutMs}ms.`
			);
		options.signal?.throwIfAborted();
		const contents = await readFile(options.logPath).catch(() =>
			Buffer.alloc(0)
		);
		if (contents.byteLength < offset) {
			offset = 0;
			buffered = '';
		}
		if (contents.byteLength > offset) {
			buffered += contents.subarray(offset).toString('utf8');
			offset = contents.byteLength;
			const lines = buffered.split(/\r?\n/u);
			buffered = lines.pop() ?? '';
			const apply = findHmrApply(lines);
			if (apply) return apply;
		}
		await sleep(100);

		return poll();
	};

	return poll();
};
