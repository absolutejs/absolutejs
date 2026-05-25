import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { toModuleSpecifier, type ProjectContext } from './context';
import { toCamelCase, toKebabCase } from './naming';
import { emptyOutcome, type GenerateOutcome } from './outcome';
import { wirePluginUse } from './routeWiring';

const apiPluginTemplate = (pluginName: string, base: string) =>
	`import { Elysia } from 'elysia';

export const ${pluginName} = new Elysia()
	.get('${base}', () => [])
	.post('${base}', ({ body }) => body);
`;

export const generateApi = (project: ProjectContext, rawName: string) => {
	const camel = toCamelCase(rawName);
	const kebab = toKebabCase(rawName);
	const pluginName = `${camel}Plugin`;
	const base = `/api/${kebab}`;
	const outcome: GenerateOutcome = { ...emptyOutcome(), route: base };

	const pluginsDir = join(dirname(project.serverEntry), 'plugins');
	const fileAbs = join(pluginsDir, `${pluginName}.ts`);
	if (existsSync(fileAbs)) {
		outcome.notes.push(
			`${pluginName} already exists at ${fileAbs} — skipped.`
		);

		return outcome;
	}

	mkdirSync(pluginsDir, { recursive: true });
	writeFileSync(fileAbs, apiPluginTemplate(pluginName, base), 'utf-8');
	outcome.created.push(fileAbs);

	const specifier = toModuleSpecifier(
		dirname(project.serverEntry),
		fileAbs.replace(/\.ts$/, '')
	);
	const wired = wirePluginUse(project.serverEntry, pluginName, specifier);
	if (wired.kind === 'edited') outcome.updated.push(wired.routingFile);
	else outcome.manual = { reason: wired.reason, snippet: wired.snippet };

	return outcome;
};
