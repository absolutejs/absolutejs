import { describe, expect, test } from 'bun:test';
import {
	readHeadStylesheets,
	readHeadTitle
} from '../../../src/core/routeAssets';

describe('routeAssets', () => {
	test('reads stylesheet hrefs out of a document head', () => {
		const head =
			'<head><title>Vue</title>' +
			'<link rel="stylesheet" href="/css/a-1.css">' +
			"<link href='/css/b-2.css' rel='stylesheet'/>" +
			'<link rel=stylesheet href=/css/c-3.css>' +
			'<link rel="stylesheet" href="/css/a-1.css">' +
			'<link rel="modulepreload" href="/js/vendor.js">' +
			'<link rel="icon" href="/favicon.ico"></head>';

		expect(readHeadStylesheets(head)).toEqual([
			'/css/a-1.css',
			'/css/b-2.css',
			'/css/c-3.css'
		]);
	});

	test('handles a bare head fragment and an absent head', () => {
		expect(
			readHeadStylesheets(
				'<style>.a{}</style><link rel="stylesheet" href="/x.css">'
			)
		).toEqual(['/x.css']);
		expect(readHeadStylesheets('')).toEqual([]);
		expect(readHeadStylesheets(undefined)).toEqual([]);
	});

	test('reads and decodes the title', () => {
		expect(
			readHeadTitle('<head><title>AbsoluteJS &amp; Vue</title></head>')
		).toBe('AbsoluteJS & Vue');
		expect(readHeadTitle('<head><title>  </title></head>')).toBeUndefined();
		expect(readHeadTitle('<head></head>')).toBeUndefined();
		expect(readHeadTitle(undefined)).toBeUndefined();
	});
});
