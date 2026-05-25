import { existsSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { installPackages } from '../../add/dependencies';
import { AUTH_SCAFFOLDS, type AuthScaffold } from './authScaffolds';
import { resolveAuthState } from './resolveAuthState';
import type { AuthScaffoldResult } from '../../../../types/authPanel';

// Render the starter wiring file for one feature: a combined @absolutejs/auth import,
// an optional `type User` placeholder for generic configs, the guidance note, and the
// typed `export const <feature>Config = {...}` block with TODO-stub fields.
const renderScaffold = (scaffold: AuthScaffold) => {
	const importNames = [...scaffold.imports, `type ${scaffold.typeName}`];
	const importLine = `import { ${importNames.join(', ')} } from '@absolutejs/auth';`;
	const userType = scaffold.generic
		? "\n// TODO: replace with your app's user type (the one you pass to auth<User>()).\ntype User = {\n\tsub: string;\n};\n"
		: '';
	const note = scaffold.note ? `\n// ${scaffold.note}\n` : '\n';
	const generic = scaffold.generic ? '<User>' : '';
	const body = scaffold.fields
		.map((field) => `\t${field.name}: ${field.value}`)
		.join(',\n');

	return `${importLine}\n${userType}${note}export const ${scaffold.exportName}: ${scaffold.typeName}${generic} = {\n${body}\n};\n`;
};

// Where to drop the file: beside the detected auth() setup, else src/, else cwd.
const targetDir = (cwd: string) => {
	const { setupPath } = resolveAuthState(cwd);
	if (setupPath) return dirname(resolve(cwd, setupPath));
	const src = join(cwd, 'src');

	return existsSync(src) ? src : cwd;
};

const spreadFor = (scaffold: AuthScaffold) =>
	`import { ${scaffold.exportName} } from './${scaffold.exportName}';\n// add to your auth() call:\n${scaffold.configKey}: ${scaffold.exportName}`;

const failure = (message: string): AuthScaffoldResult => ({
	created: null,
	installed: false,
	message,
	ok: false,
	spreadSnippet: null
});

type ScaffoldOptions = {
	install?: boolean;
};

export const scaffoldAuthFeature = (
	cwd: string,
	id: string,
	options: ScaffoldOptions = {}
): AuthScaffoldResult => {
	const scaffold = AUTH_SCAFFOLDS[id];
	if (!scaffold) return failure(`Unknown auth feature "${id}".`);

	const filePath = join(targetDir(cwd), `${scaffold.exportName}.ts`);
	const relPath = relative(cwd, filePath);
	if (existsSync(filePath)) {
		return {
			created: null,
			installed: false,
			message: `${relPath} already exists — left untouched.`,
			ok: true,
			spreadSnippet: spreadFor(scaffold)
		};
	}

	const install = options.install ?? true;
	const installOk =
		install && scaffold.packages.length > 0
			? installPackages(cwd, scaffold.packages)
			: true;
	writeFileSync(filePath, renderScaffold(scaffold));

	return {
		created: relPath,
		installed: installOk,
		message: `Scaffolded ${relPath}.`,
		ok: true,
		spreadSnippet: spreadFor(scaffold)
	};
};
