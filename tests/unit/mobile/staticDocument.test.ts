import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import {
	hashAbsoluteMobileStaticDocument,
	rewriteAbsoluteMobileHtmxRequests,
	sanitizeAbsoluteMobileHtmxFragment
} from '../../../src/mobile/staticDocument';

beforeAll(() => GlobalRegistrator.register());
afterAll(() => GlobalRegistrator.unregister());

describe('mobile static documents', () => {
	test('rewrites root-relative form and HTMX requests to the deployed backend', () => {
		const source =
			'<form action="/save"><button hx-post="/count">Count</button></form><div hx-get="https://api.example.com/status"></div>';

		expect(
			rewriteAbsoluteMobileHtmxRequests(source, 'https://api.example.com')
		).toBe(
			'<form action="https://api.example.com/save"><button hx-post="https://api.example.com/count">Count</button></form><div hx-get="https://api.example.com/status"></div>'
		);
	});

	test('strips executable and cross-origin behavior from server fragments', () => {
		const sanitized = sanitizeAbsoluteMobileHtmxFragment(
			`<section style="background:red" onclick="steal()" hx-on:load="steal()">
				<script>steal()</script>
				<iframe></iframe>
				<button hx-post="https://evil.example/pwn">Bad</button>
				<button hx-post="/safe">Safe</button>
				<a href="javascript:steal()">Unsafe link</a>
			</section>`,
			'https://api.example.com'
		);

		expect(sanitized).not.toContain('script');
		expect(sanitized).not.toContain('iframe');
		expect(sanitized).not.toContain('onclick');
		expect(sanitized).not.toContain('hx-on');
		expect(sanitized).toContain('style="background:red"');
		expect(sanitized).not.toContain('evil.example');
		expect(sanitized).not.toContain('javascript:');
		expect(sanitized).toContain('hx-post="https://api.example.com/safe"');
	});

	test('uses a deterministic SHA-256 integrity identity', async () => {
		expect(await hashAbsoluteMobileStaticDocument('<h1>Hello</h1>')).toBe(
			'e2c6c0ea7c7900c31f953e48d30d5e839801ab90630d751e7c8426ed5859da47'
		);
	});
});
