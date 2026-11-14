import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import {
	REACT_STREAM_SLOT_FAST_DELAY_MS,
	REACT_STREAM_SLOT_SLOW_DELAY_MS,
	UNFOUND_INDEX
} from '../../../src/constants';
import { StreamSlot, SuspenseSlot } from '../../../src/react/components';
import { handleReactPageRequest } from '../../../src/react';

const delay = async (milliseconds: number) => Bun.sleep(milliseconds);
const resolveReactSuspenseValue = async () => {
	await delay(REACT_STREAM_SLOT_FAST_DELAY_MS);

	return {
		label: 'react suspense resolved'
	};
};

const ReactStreamingTestPage = () => (
	<html lang="en">
		<head>
			<title>React Streaming Test</title>
		</head>
		<body>
			<main>
				<StreamSlot
					fallbackHtml="<p>fast loading</p>"
					id="react-fast"
					resolve={async () => {
						await delay(REACT_STREAM_SLOT_FAST_DELAY_MS);

						return '<section>fast resolved</section>';
					}}
				/>
				<StreamSlot
					fallbackHtml="<p>slow loading</p>"
					id="react-slow"
					resolve={async () => {
						await delay(REACT_STREAM_SLOT_SLOW_DELAY_MS);

						return '<section>slow resolved</section>';
					}}
				/>
			</main>
		</body>
	</html>
);

describe('handleReactPageRequest streaming', () => {
	test('injects runtime and appends patches for registered StreamSlot components', async () => {
		const response = await handleReactPageRequest({
			collectStreamingSlots: true,
			index: '/react-test-index.js',
			Page: ReactStreamingTestPage
		});
		const html = await response.text();
		const fastPatchIndex = html.indexOf('"react-fast"');
		const slowPatchIndex = html.indexOf('"react-slow"');

		expect(response.headers.get('Content-Type')).toBe('text/html');
		expect(html).toContain('__ABS_SLOT_ENQUEUE__');
		expect(html).toContain('id="react-fast"');
		expect(html).toContain('id="react-slow"');
		expect(html).toContain('fast resolved');
		expect(html).toContain('slow resolved');
		expect(html).toContain('__ABSOLUTE_SSR_TEXT_BASELINES__');
		expect(html.indexOf('__ABSOLUTE_SSR_TEXT_BASELINES__')).toBeLessThan(
			html.lastIndexOf('/react-test-index.js')
		);
		expect(fastPatchIndex).toBeGreaterThan(UNFOUND_INDEX);
		expect(slowPatchIndex).toBeGreaterThan(UNFOUND_INDEX);
		expect(fastPatchIndex).toBeLessThan(slowPatchIndex);
	});

	test('renders framework-level SuspenseSlot fallback and resolved content', async () => {
		const renderReactSuspenseTestSlot = () => (
			<SuspenseSlot
				fallback={
					<article>
						<p>react suspense fallback</p>
					</article>
				}
				id="react-suspense"
				promise={resolveReactSuspenseValue()}
			>
				{(value: { label: string }) => (
					<section>
						<strong>{value.label}</strong>
					</section>
				)}
			</SuspenseSlot>
		);
		const ReactSuspenseTestPage = () => (
			<html lang="en">
				<head>
					<title>React Suspense Slot Test</title>
				</head>
				<body>
					<main>{renderReactSuspenseTestSlot()}</main>
				</body>
			</html>
		);
		const response = await handleReactPageRequest({
			collectStreamingSlots: true,
			index: '/react-suspense-test-index.js',
			Page: ReactSuspenseTestPage
		});
		const html = await response.text();

		expect(html).toContain('react suspense fallback');
		expect(html).toContain('react suspense resolved');
		expect(html).toContain('__ABS_SLOT_ENQUEUE__');
		expect(html).toContain('id="react-suspense"');
	});
});

const SuspenseOnlyPage = ({ label }: { label: string }) => (
	<html lang="en">
		<head>
			<title>Suspense Default</title>
		</head>
		<body>
			<main>
				<SuspenseSlot
					fallback={<p>default fallback</p>}
					id="react-default-suspense"
					resolve={async () => {
						await delay(REACT_STREAM_SLOT_FAST_DELAY_MS);

						return <section>{label}</section>;
					}}
				/>
			</main>
		</body>
	</html>
);

const NoSlotPage = () => (
	<html lang="en">
		<head>
			<title>No Slots</title>
		</head>
		<body>
			<main>
				<p>plain page</p>
			</main>
		</body>
	</html>
);

const captureWarnings = () => {
	const spy = spyOn(console, 'log');
	const warnings = () =>
		spy.mock.calls
			.map((call) => call.map(String).join(' '))
			.filter((line) => line.includes('streaming slot collection'));

	return {
		warnings,
		restore: () => spy.mockRestore()
	};
};

describe('handleReactPageRequest default streaming slot collection', () => {
	const originalNodeEnv = process.env.NODE_ENV;
	afterEach(() => {
		process.env.NODE_ENV = originalNodeEnv;
	});

	test('streams a SuspenseSlot without collectStreamingSlots', async () => {
		const capture = captureWarnings();
		try {
			const response = await handleReactPageRequest({
				index: '/react-default-index.js',
				Page: SuspenseOnlyPage,
				props: { label: 'default resolved' }
			});
			const html = await response.text();

			expect(html).toContain('default fallback');
			expect(html).toContain('__ABS_SLOT_ENQUEUE__');
			expect(html).toContain('default resolved');
			expect(capture.warnings()).toEqual([]);
		} finally {
			capture.restore();
		}
	});

	test('a page without slots renders byte-identically with collection on and off', async () => {
		const render = async (collectStreamingSlots?: boolean) => {
			const response = await handleReactPageRequest({
				collectStreamingSlots,
				index: '/react-no-slot-index.js',
				Page: NoSlotPage
			});

			return {
				headers: [...response.headers.entries()],
				html: await response.text()
			};
		};
		const off = await render(false);
		const byDefault = await render();
		const collected = await render(true);

		expect(byDefault).toEqual(off);
		expect(collected).toEqual(off);
		expect(off.html).not.toContain('__ABS_SLOT_ENQUEUE__');
	});

	test('collectStreamingSlots: false keeps the fallback and warns once per render in dev', async () => {
		process.env.NODE_ENV = 'development';
		const capture = captureWarnings();
		try {
			const response = await handleReactPageRequest({
				collectStreamingSlots: false,
				index: '/react-off-index.js',
				Page: SuspenseOnlyPage,
				props: { label: 'never resolved' }
			});
			const html = await response.text();

			expect(html).toContain('default fallback');
			expect(html).not.toContain('<section>never resolved');
			expect(html).not.toContain('__ABS_SLOT_ENQUEUE__');
			const warnings = capture.warnings();
			expect(warnings).toHaveLength(1);
			expect(warnings[0]).toContain('SuspenseSlot');
			expect(warnings[0]).toContain('collectStreamingSlots: false');
		} finally {
			capture.restore();
		}
	});

	test('collectStreamingSlots: false warns in production, once per process', async () => {
		process.env.NODE_ENV = 'production';
		const capture = captureWarnings();
		try {
			const ProductionOffPage = () => (
				<SuspenseOnlyPage label="production off" />
			);
			const renderOnce = async () => {
				const response = await handleReactPageRequest({
					collectStreamingSlots: false,
					index: '/react-prod-off-index.js',
					Page: ProductionOffPage
				});
				await response.text();
			};
			await renderOnce();
			await renderOnce();
			await renderOnce();
			const warnings = capture.warnings();
			expect(warnings).toHaveLength(1);
			expect(warnings[0]).toContain('collectStreamingSlots: false');
		} finally {
			capture.restore();
		}
	});
});
