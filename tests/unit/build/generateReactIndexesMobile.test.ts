import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { generateReactIndexFiles } from '../../../src/build/generateReactIndexes';

const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(
		temporaryDirectories.splice(0).map((directory) =>
			rm(directory, { force: true, recursive: true })
		)
	);
});

describe('generated React mobile entry', () => {
	test('client-renders data envelopes instead of hydrating absent server markup', async () => {
		const root = await mkdtemp(join(tmpdir(), 'absolute-react-mobile-'));
		temporaryDirectories.push(root);
		const pages = join(root, 'pages');
		const indexes = join(root, 'indexes');
		await mkdir(pages, { recursive: true });
		await writeFile(
			join(pages, 'Account.tsx'),
			'export default function Account() { return <main>Account</main>; }'
		);

		await generateReactIndexFiles(pages, indexes, false);
		const source = await readFile(join(indexes, 'Account.tsx'), 'utf8');

		expect(source).toContain(
			"window.__ABSOLUTE_PAGE_RENDER_MODE__ === 'client'"
		);
		expect(source).toContain(
			'if (window.__SSR_DIRTY__ || shouldClientRender)'
		);
		expect(source).toContain('root = createRoot(container)');
	});

	test('generates a dev remount hook for Bun builds without Fast Refresh transforms', async () => {
		const root = await mkdtemp(join(tmpdir(), 'absolute-react-remount-'));
		temporaryDirectories.push(root);
		const pages = join(root, 'pages');
		const indexes = join(root, 'indexes');
		await mkdir(pages, { recursive: true });
		await writeFile(
			join(pages, 'Account.tsx'),
			'export default function Account() { return <main>Account</main>; }'
		);

		await generateReactIndexFiles(pages, indexes, true);
		const source = await readFile(join(indexes, 'Account.tsx'), 'utf8');

		expect(source).toContain('window.__ABS_REACT_REMOUNT__');
		expect(source).toContain('window.__REACT_ROOT__.render(element)');
		expect(source).not.toContain(
			'window.__REACT_ROOT__.unmount();\n\tconst nextRoot'
		);
	});
});
