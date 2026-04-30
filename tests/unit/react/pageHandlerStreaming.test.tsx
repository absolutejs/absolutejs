import { describe, expect, test } from 'bun:test';
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
			Page: ReactStreamingTestPage,
			index: '/react-test-index.js',
			collectStreamingSlots: true
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
			Page: ReactSuspenseTestPage,
			index: '/react-suspense-test-index.js',
			collectStreamingSlots: true
		});
		const html = await response.text();

		expect(html).toContain('react suspense fallback');
		expect(html).toContain('react suspense resolved');
		expect(html).toContain('__ABS_SLOT_ENQUEUE__');
		expect(html).toContain('id="react-suspense"');
	});
});
