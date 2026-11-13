import { describe, expect, test } from 'bun:test';
import {
	clientModuleId,
	isClientModuleSource
} from '../../../src/build/buildReactServerComponents';
import {
	flightPayloadScript,
	injectFlightPayload
} from '../../../src/react/serverComponents/flightPayload';

const streamOf = (chunks: string[]) => {
	const encoder = new TextEncoder();

	return new ReadableStream<Uint8Array>({
		start(controller) {
			for (const chunk of chunks)
				controller.enqueue(encoder.encode(chunk));
			controller.close();
		}
	});
};

const PAYLOAD_PUSH = '(self.__absoluteReactServerPayload??=[]).push(';

describe('flightPayloadScript', () => {
	test('escapes characters that could end the script element', () => {
		const script = flightPayloadScript(
			'0:"</script><script>alert(1)</script><!--"\u2028',
			'abc'
		);

		expect(script.startsWith(`<script nonce="abc">${PAYLOAD_PUSH}`)).toBe(
			true
		);
		const body = script.slice(
			'<script nonce="abc">'.length,
			-'</script>'.length
		);
		expect(body).not.toContain('<');
		expect(body).not.toContain('\u2028');
		const decoded: unknown = JSON.parse(
			body.slice(PAYLOAD_PUSH.length, -1)
		);
		expect(decoded).toBe(
			'0:"</script><script>alert(1)</script><!--"\u2028'
		);
	});

	test('omits the nonce attribute without one', () => {
		expect(flightPayloadScript('x', undefined).startsWith('<script>')).toBe(
			true
		);
	});
});

describe('injectFlightPayload', () => {
	test('waits for <body>, then lands the rest before </body>', async () => {
		const html = streamOf([
			'<!DOCTYPE html><html><head><title>t</title></head>',
			'<body><main>shell</main>',
			'<div hidden id="S:0">late</div>',
			'</body></html>'
		]);
		const flight = streamOf(['0:["$","main"]\n', '1:"late"\n']);
		const output = await new Response(
			injectFlightPayload(html, flight, 'n1')
		).text();

		const headEnd = output.indexOf('</head>');
		const firstScript = output.indexOf(PAYLOAD_PUSH);
		const bodyClose = output.indexOf('</body>');
		expect(firstScript).toBeGreaterThan(headEnd);
		expect(output.lastIndexOf(PAYLOAD_PUSH)).toBeLessThan(bodyClose);
		expect(output.endsWith('</body></html>')).toBe(true);
		expect(output).toContain('0:[\\"$\\",\\"main\\"]\\n');
		expect(output).toContain('1:\\"late\\"\\n');
		expect(output.match(/<script nonce="n1">/g)?.length).toBe(2);
	});

	test('keeps a multi-byte character split across Flight chunks intact', async () => {
		const bytes = new TextEncoder().encode('0:"héllo"\n');
		const flight = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(bytes.slice(0, 4));
				controller.enqueue(bytes.slice(4));
				controller.close();
			}
		});
		const output = await new Response(
			injectFlightPayload(
				streamOf(['<html><body></body></html>']),
				flight
			)
		).text();

		// The decoder holds the split byte until its character is complete.
		expect(output).toContain('push("\u00e9llo');
		expect(output).not.toContain('�');
	});
});

describe('client module detection', () => {
	test('finds the directive after comments and whitespace only', () => {
		expect(isClientModuleSource(`'use client';\nexport const a = 1;`)).toBe(
			true
		);
		expect(
			isClientModuleSource(
				`// header\n/* note */\n"use client"\nexport {}`
			)
		).toBe(true);
		expect(
			isClientModuleSource(`import x from 'y';\n'use client';\nexport {}`)
		).toBe(false);
		expect(isClientModuleSource(`const s = 'use client';`)).toBe(false);
	});

	test('module ids are stable hashes of the project-relative path', () => {
		const id = clientModuleId('/app', '/app/rsc/components/Counter.tsx');

		expect(id).toBe(
			clientModuleId('/app', '/app/rsc/components/Counter.tsx')
		);
		expect(id).not.toContain('Counter');
		expect(id).toHaveLength(16);
	});
});
