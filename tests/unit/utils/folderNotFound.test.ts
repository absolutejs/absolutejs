import { afterAll, afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ConventionsMap } from '../../../types/conventions';
import {
	getConventions,
	renderFolderNotFound,
	setConventions
} from '../../../src/utils/resolveConvention';

/* Which route folder's `not-found` answers an address that no route
 * does. The files are HTML, which is rendered by being read, so each
 * says which folder it is. */

const directories: string[] = [];
const before = getConventions();

afterEach(() => setConventions(before));
afterAll(async () => {
	await Promise.all(
		directories.map((dir) => rm(dir, { force: true, recursive: true }))
	);
});

const folders = async (paths: string[]) => {
	const dir = await mkdtemp(join(tmpdir(), 'absolute-folder-not-found-'));
	directories.push(dir);
	const entries = await Promise.all(
		paths.map(async (path, index) => {
			const file = join(dir, `${index}.html`);
			await Bun.write(file, `<p>not found in ${path}</p>`);

			return { notFound: file, path };
		})
	);
	const map: ConventionsMap = { html: { folders: entries } };
	setConventions(map);
};

const answerFor = async (pathname: string) => {
	const response = await renderFolderNotFound(pathname);

	return response
		? { status: response.status, text: await response.text() }
		: null;
};

describe('the not-found of the folder an address falls under', () => {
	test('answers anything under the folder, with a 404', async () => {
		await folders(['/blog']);

		expect(await answerFor('/blog/2024/january')).toEqual({
			status: 404,
			text: '<p>not found in /blog</p>'
		});
		expect((await answerFor('/blog'))?.text).toContain('/blog');
		expect((await answerFor('/blog/'))?.text).toContain('/blog');
	});

	test('does not answer what merely starts the same', async () => {
		await folders(['/blog']);

		expect(await answerFor('/blogger')).toBeNull();
		expect(await answerFor('/other')).toBeNull();
	});

	test('is the deepest folder that has one', async () => {
		await folders(['/', '/blog', '/blog/drafts']);

		expect((await answerFor('/blog/drafts/one'))?.text).toContain(
			'/blog/drafts'
		);
		expect((await answerFor('/blog/one'))?.text).toContain('in /blog<');
		expect((await answerFor('/elsewhere'))?.text).toContain('in /<');
	});

	test('a param in the folder’s path stands for one segment', async () => {
		await folders(['/users/:id']);

		expect((await answerFor('/users/7/settings'))?.text).toContain(
			'/users/:id'
		);
		expect(await answerFor('/users')).toBeNull();
	});

	test('between two as deep, the one that names more of the address', async () => {
		await folders(['/users/:id', '/users/me']);

		expect((await answerFor('/users/me/settings'))?.text).toContain(
			'/users/me'
		);
		expect((await answerFor('/users/7/settings'))?.text).toContain(
			'/users/:id'
		);
	});

	test('a folder whose file cannot be read gives way to the next', async () => {
		await folders(['/blog']);
		const map: ConventionsMap = {
			html: {
				folders: [
					{ notFound: '/nowhere/missing.html', path: '/blog/drafts' },
					...(getConventions().html?.folders ?? [])
				]
			}
		};
		setConventions(map);
		const original = console.error;
		console.error = () => undefined;
		try {
			expect((await answerFor('/blog/drafts/one'))?.text).toContain(
				'in /blog<'
			);
		} finally {
			console.error = original;
		}
	});

	test('no folders is no answer', async () => {
		setConventions({});

		expect(await answerFor('/anything')).toBeNull();
	});
});
