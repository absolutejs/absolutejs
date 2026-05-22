import ts from 'typescript';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ConfigField, ConfigFieldKind } from '../../../types/config';

const VIRTUAL_NAME = '__absolute_type_introspect__.ts';

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
	typeName: string,
	options: ts.CompilerOptions,
	exclude: Set<string>
) => {
	const virtualPath = resolve(cwd, VIRTUAL_NAME);
	const source = `import type { ${typeName} } from '${specifier}';\ndeclare const value: ${typeName};\nexport { value };\n`;
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
			const name = symbol.getName();
			if (exclude.has(name) || name.startsWith('__')) continue;
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
				name,
				optional: (symbol.flags & ts.SymbolFlags.Optional) !== 0,
				typeText: checker.typeToString(propertyType)
			});
		}
	});

	return fields.sort((left, right) => left.name.localeCompare(right.name));
};

const cache = new Map<string, ConfigField[]>();

// Recover a runtime catalog (names, kinds, JSDoc) from a TypeScript type that
// is otherwise erased at runtime. Reads the *real* exported type, so it can
// never drift from the source. Resolves the type from the installed
// `@absolutejs/absolute`, falling back to the local barrel inside the framework
// repo. `exclude` drops members that aren't user-authored (CLI/runtime fields).
export const introspectType = (
	cwd: string,
	typeName: string,
	exclude: Set<string> = new Set()
) => {
	const cached = cache.get(typeName);
	if (cached) return cached;
	const options = compilerOptionsFor(cwd);
	const specifiers = ['@absolutejs/absolute'];
	if (isFrameworkRepo(cwd) && existsSync(resolve(cwd, 'types/index.ts'))) {
		specifiers.push('./types');
	}

	for (const specifier of specifiers) {
		try {
			const fields = introspectFrom(
				cwd,
				specifier,
				typeName,
				options,
				exclude
			);
			if (fields.length > 0) {
				cache.set(typeName, fields);

				return fields;
			}
		} catch {
			/* try the next specifier */
		}
	}

	cache.set(typeName, []);

	return cache.get(typeName) ?? [];
};
