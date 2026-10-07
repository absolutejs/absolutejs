import { expect, test } from 'bun:test';
import { getMimeType } from '../../../src/dev/assetStore';

test('PDF documents are served for browser viewing', () => {
	expect(getMimeType('/forms/consent.pdf')).toBe('application/pdf');
	expect(getMimeType('/images/photo.png')).toBe('image/png');
	expect(getMimeType('/unknown.bin')).toBe('application/octet-stream');
});
