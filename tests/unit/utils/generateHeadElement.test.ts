import { describe, expect, test } from 'bun:test';
import { generateHeadElement } from '../../../src/utils/generateHeadElement';

describe('generateHeadElement', () => {
	test('generates head with defaults', () => {
		const head = generateHeadElement();
		expect(head).toContain('<title>AbsoluteJS</title>');
		expect(head).toContain('content="A page created using AbsoluteJS"');
		expect(head).toContain('favicon.ico');
		expect(head).toContain('<meta charset="UTF-8">');
		expect(head).toContain('viewport');
	});

	test('uses custom title', () => {
		const head = generateHeadElement({ title: 'My App' });
		expect(head).toContain('<title>My App</title>');
	});

	test('uses custom description', () => {
		const head = generateHeadElement({ description: 'A cool app' });
		expect(head).toContain('content="A cool app"');
	});

	test('includes single CSS path', () => {
		const head = generateHeadElement({ cssPath: '/styles/main.css' });
		expect(head).toContain(
			'<link rel="stylesheet" href="/styles/main.css" type="text/css">'
		);
	});

	test('includes multiple CSS paths', () => {
		const head = generateHeadElement({
			cssPath: ['/styles/a.css', '/styles/b.css']
		});
		expect(head).toContain('href="/styles/a.css"');
		expect(head).toContain('href="/styles/b.css"');
	});

	test('includes font preconnect when font provided', () => {
		const head = generateHeadElement({ font: 'Inter' });
		expect(head).toContain('fonts.googleapis.com');
		expect(head).toContain('fonts.gstatic.com');
		expect(head).toContain('family=Inter');
	});

	test('omits font when not provided', () => {
		const head = generateHeadElement();
		expect(head).not.toContain('fonts.googleapis.com');
	});

	test('uses custom icon', () => {
		const head = generateHeadElement({ icon: '/custom-icon.png' });
		expect(head).toContain('href="/custom-icon.png"');
	});

	test('omits CSS link when no cssPath', () => {
		const head = generateHeadElement();
		expect(head).not.toContain('rel="stylesheet"');
	});
});
