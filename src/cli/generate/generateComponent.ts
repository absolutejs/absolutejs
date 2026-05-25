import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { componentTemplates } from './componentTemplates';
import type { ProjectContext } from './context';
import type { FrameworkKey } from './frameworkKey';
import { frameworks } from './frameworks';
import { toKebabCase, toPascalCase, toTitleCase } from './naming';
import { emptyOutcome, type GenerateOutcome } from './outcome';

export const generateComponent = (
	project: ProjectContext,
	framework: FrameworkKey,
	rawName: string
) => {
	const def = frameworks[framework];
	const pascal = toPascalCase(rawName);
	const kebab = toKebabCase(rawName);
	const outcome: GenerateOutcome = emptyOutcome();
	const frameworkDir = project.frameworkDirs[framework];
	if (!frameworkDir) {
		outcome.manual = { reason: 'framework directory missing', snippet: '' };

		return outcome;
	}

	const fileAbs = join(
		frameworkDir,
		'components',
		def.componentFile({ kebab, pascal })
	);
	if (existsSync(fileAbs)) {
		outcome.notes.push(`${pascal} already exists at ${fileAbs} — skipped.`);

		return outcome;
	}

	mkdirSync(dirname(fileAbs), { recursive: true });
	writeFileSync(
		fileAbs,
		componentTemplates[framework]({
			kebab,
			pascal,
			title: toTitleCase(rawName)
		}),
		'utf-8'
	);
	outcome.created.push(fileAbs);

	return outcome;
};
