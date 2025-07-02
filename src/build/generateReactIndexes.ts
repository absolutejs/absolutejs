import { mkdir, rm, writeFile } from 'fs/promises';
import { basename, join } from 'path';
import { Glob } from 'bun';

export const generateReactIndexFiles = async (
	reactPagesDirectory: string,
	reactIndexesDirectory: string
) => {
	await rm(reactIndexesDirectory, { force: true, recursive: true });
	await mkdir(reactIndexesDirectory);

	const pagesGlob = new Glob('*.*');
	const files: string[] = [];
	for await (const file of pagesGlob.scan({ cwd: reactPagesDirectory })) {
		files.push(file);
	}
	const promises = files.map(async (file) => {
		const fileName = basename(file);
		const [componentName] = fileName.split('.');
		const content = [
			`import { hydrateRoot } from 'react-dom/client';`,
			`import type { ComponentType } from 'react'`,
			`import { ${componentName} } from '../pages/${componentName}';\n`,
			`type PropsOf<C> = C extends ComponentType<infer P> ? P : never;\n`,
			`declare global {`,
			`\tinterface Window {`,
			`\t\t__INITIAL_PROPS__: PropsOf<typeof ${componentName}>`,
			`\t}`,
			`}\n`,
			`hydrateRoot(document, <${componentName} {...window.__INITIAL_PROPS__} />);`
		].join('\n');

		return writeFile(
			join(reactIndexesDirectory, `${componentName}.tsx`),
			content
		);
	});
	await Promise.all(promises);
};
