import ts from 'typescript';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type {
	ConfigField,
	ConfigFieldKind
} from '../../../../types/absoluteConfig';

const VIRTUAL_NAME = '__absolute_config_introspect__.ts';

// `BaseBuildConfig` is the authorable shape; these few members are injected by
// the CLI/runtime (not written in defineConfig), so they're hidden from the UI.
const RUNTIME_FIELDS = new Set([
	'cwd',
	'config',
	'entry',
	'mode',
	'incrementalFiles'
]);

const isFrameworkRepo = (cwd: string) => {
	try {
		const pkg = JSON.parse(
			readFileSync(resolve(cwd, 'package.json'), 'utf-8')
		);

		return pkg?.name === '@absolutejs/absolute';
	} catch {
		return false;
	}
};

const compilerOptionsFor = (cwd: string) => {
	const tsconfigPath = ts.findConfigFile(
		cwd,
		ts.sys.fileExists,
		'tsconfig.json'
	);
	if (!tsconfigPath) return ts.getDefaultCompilerOptions();
	const parsed = ts.getParsedCommandLineOfConfigFile(tsconfigPath, {}, {
		...ts.sys,
		onUnRecoverableConfigFileDiagnostic: () => {}
	} as ts.ParseConfigFileHost);

	return parsed?.options ?? ts.getDefaultCompilerOptions();
};

const nonUndefinedMembers = (type: ts.Type) =>
	type.isUnion()
		? type.types.filter(
				(member) => (member.flags & ts.TypeFlags.Undefined) === 0
			)
		: [type];

const classify = (
	type: ts.Type
): { choices: string[]; kind: ConfigFieldKind } => {
	const members = nonUndefinedMembers(type);
	if (members.length === 0) return { choices: [], kind: 'complex' };

	if (
		members.every(
			(member) => (member.flags & ts.TypeFlags.BooleanLike) !== 0
		)
	) {
		return { choices: [], kind: 'boolean' };
	}
	if (members.every((member) => member.isStringLiteral())) {
		const choices = members.map((member) => String(member.value));

		return choices.length > 1
			? { choices, kind: 'enum' }
			: { choices: [], kind: 'string' };
	}
	if (members.some((member) => (member.flags & ts.TypeFlags.String) !== 0)) {
		return { choices: [], kind: 'string' };
	}
	if (
		members.every(
			(member) => (member.flags & ts.TypeFlags.NumberLike) !== 0
		)
	) {
		return { choices: [], kind: 'number' };
	}

	return { choices: [], kind: 'complex' };
};

const introspectFrom = (
	cwd: string,
	specifier: string,
	options: ts.CompilerOptions
) => {
	const virtualPath = resolve(cwd, VIRTUAL_NAME);
	const source = `import type { BaseBuildConfig } from '${specifier}';\ndeclare const value: BaseBuildConfig;\nexport { value };\n`;
	const host = ts.createCompilerHost(options, true);
	const getSourceFile = host.getSourceFile.bind(host);
	host.getSourceFile = (fileName, languageVersion, onError, shouldCreate) =>
		fileName === virtualPath
			? ts.createSourceFile(fileName, source, languageVersion, true)
			: getSourceFile(fileName, languageVersion, onError, shouldCreate);
	const fileExists = host.fileExists.bind(host);
	host.fileExists = (fileName) =>
		fileName === virtualPath ? true : fileExists(fileName);
	const readFile = host.readFile.bind(host);
	host.readFile = (fileName) =>
		fileName === virtualPath ? source : readFile(fileName);

	const program = ts.createProgram([virtualPath], options, host);
	const checker = program.getTypeChecker();
	const sourceFile = program.getSourceFile(virtualPath);
	if (!sourceFile) return [];

	const fields: ConfigField[] = [];
	sourceFile.forEachChild((node) => {
		if (!ts.isVariableStatement(node)) return;
		const declaration = node.declarationList.declarations[0];
		if (!declaration) return;
		const type = checker.getTypeAtLocation(declaration);
		for (const symbol of checker.getPropertiesOfType(type)) {
			if (RUNTIME_FIELDS.has(symbol.getName())) continue;
			const propertyType = checker.getTypeOfSymbolAtLocation(
				symbol,
				declaration
			);
			const { choices, kind } = classify(propertyType);
			fields.push({
				choices,
				description: ts
					.displayPartsToString(
						symbol.getDocumentationComment(checker)
					)
					.trim(),
				kind,
				name: symbol.getName(),
				optional: (symbol.flags & ts.SymbolFlags.Optional) !== 0,
				typeText: checker.typeToString(propertyType)
			});
		}
	});

	return fields.sort((left, right) => left.name.localeCompare(right.name));
};

let cached: ConfigField[] | null = null;

// Source the catalog from the framework's own BuildConfig type so it can never
// drift. Resolves the type from the installed `@absolutejs/absolute`; when run
// inside the framework repo itself, falls back to the local type.
export const introspectConfigFields = (cwd: string) => {
	if (cached) return cached;
	const options = compilerOptionsFor(cwd);
	const specifiers = ['@absolutejs/absolute'];
	if (isFrameworkRepo(cwd) && existsSync(resolve(cwd, 'types/build.ts'))) {
		specifiers.push('./types/build');
	}

	for (const specifier of specifiers) {
		try {
			const fields = introspectFrom(cwd, specifier, options);
			if (fields.length > 0) {
				cached = fields;

				return fields;
			}
		} catch {
			/* try the next specifier */
		}
	}

	cached = [];

	return cached;
};
