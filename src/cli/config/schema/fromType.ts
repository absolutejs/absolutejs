import ts from 'typescript';
import {
	existsSync,
	mkdirSync,
	readFileSync,
	statSync,
	writeFileSync
} from 'node:fs';
import { resolve } from 'node:path';
import type { FieldNode, FieldSchema } from '../../../../types/config';

const VIRTUAL_NAME = '__absolute_type_introspect__.ts';
const MAX_DEPTH = 6;

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
	const base =
		tsconfigPath &&
		ts.getParsedCommandLineOfConfigFile(tsconfigPath, {}, {
			...ts.sys,
			onUnRecoverableConfigFileDiagnostic: () => {
				/* shape only — ignore config file errors */
			}
		} as ts.ParseConfigFileHost)?.options;

	// We only read the type's shape — never type-check — so skip lib checking and
	// auto-included @types/* to make program creation as fast as possible.
	return {
		...(base ?? ts.getDefaultCompilerOptions()),
		noEmit: true,
		skipDefaultLibCheck: true,
		skipLibCheck: true,
		types: []
	};
};

// Disk cache so the (multi-second) TS program creation runs once, not on every
// launch. Keyed by the framework version; in the framework repo we also fold in
// the type-source mtime so local edits during dev invalidate it.
const SCHEMA_VERSION = 1;

// Resolve the installed version of the package whose type we're introspecting, so
// the disk cache invalidates when that package upgrades. For the framework we also
// fall back to the cwd package.json (the framework repo itself).
const packageVersion = (cwd: string, specifier: string) => {
	const candidates =
		specifier === '@absolutejs/absolute'
			? [
					resolve(
						cwd,
						'node_modules',
						'@absolutejs',
						'absolute',
						'package.json'
					),
					resolve(cwd, 'package.json')
				]
			: [
					resolve(
						cwd,
						'node_modules',
						...specifier.split('/'),
						'package.json'
					)
				];
	for (const candidate of candidates) {
		try {
			const { version } = JSON.parse(readFileSync(candidate, 'utf-8'));
			if (typeof version === 'string') return version;
		} catch {
			/* try the next candidate */
		}
	}

	return 'unknown';
};

const cacheSignature = (
	cwd: string,
	typeName: string,
	local: boolean,
	specifier: string
) => {
	let signature = `${SCHEMA_VERSION}:${specifier}:${packageVersion(cwd, specifier)}`;
	if (local) {
		const file = typeName === 'PackageJson' ? 'packageJson.ts' : 'build.ts';
		try {
			signature += `:${statSync(resolve(cwd, 'types', file)).mtimeMs}`;
		} catch {
			/* type file missing — version alone keys it */
		}
	}

	return signature;
};

const cacheSlug = (specifier: string) =>
	specifier.replace('@', '').split('/').join('-');

const cacheFile = (cwd: string, typeName: string, specifier: string) => {
	const name =
		specifier === '@absolutejs/absolute'
			? typeName
			: `${typeName}.${cacheSlug(specifier)}`;

	return resolve(cwd, '.absolutejs', 'config-schema', `${name}.json`);
};

const readDiskCache = (
	cwd: string,
	typeName: string,
	signature: string,
	specifier: string
) => {
	try {
		const cached = JSON.parse(
			readFileSync(cacheFile(cwd, typeName, specifier), 'utf-8')
		);
		if (cached?.signature === signature && Array.isArray(cached.fields)) {
			return cached.fields as FieldNode[];
		}
	} catch {
		/* no/stale cache */
	}

	return null;
};

const writeDiskCache = (
	cwd: string,
	typeName: string,
	signature: string,
	fields: FieldNode[],
	specifier: string
) => {
	try {
		mkdirSync(resolve(cwd, '.absolutejs', 'config-schema'), {
			recursive: true
		});
		writeFileSync(
			cacheFile(cwd, typeName, specifier),
			JSON.stringify({ fields, signature })
		);
	} catch {
		/* cache is best-effort */
	}
};

const docOf = (symbol: ts.Symbol, checker: ts.TypeChecker) =>
	ts.displayPartsToString(symbol.getDocumentationComment(checker)).trim();

const typeOfSymbol = (symbol: ts.Symbol, checker: ts.TypeChecker) => {
	const declaration = symbol.valueDeclaration ?? symbol.declarations?.[0];

	return declaration
		? checker.getTypeOfSymbolAtLocation(symbol, declaration)
		: checker.getDeclaredTypeOfSymbol(symbol);
};

const hasFlag = (type: ts.Type, flag: ts.TypeFlags) =>
	(type.flags & flag) !== 0;

const unionParts = (type: ts.Type) => (type.isUnion() ? type.types : [type]);

const literalChoice = (type: ts.Type) => {
	if (type.isStringLiteral()) return type.value;
	if (type.isNumberLiteral()) return type.value;

	return null;
};

const toSchema = (
	type: ts.Type,
	checker: ts.TypeChecker,
	depth: number,
	seen: Set<ts.Type>
): FieldSchema => {
	const opaque = (): FieldSchema => ({
		kind: 'opaque',
		typeText: checker.typeToString(type)
	});
	if (depth > MAX_DEPTH) return opaque();

	const parts = unionParts(type).filter(
		(part) =>
			!hasFlag(part, ts.TypeFlags.Undefined) &&
			!hasFlag(part, ts.TypeFlags.Null)
	);
	if (parts.length === 0) return opaque();

	if (parts.every((part) => hasFlag(part, ts.TypeFlags.BooleanLike))) {
		return { kind: 'boolean' };
	}

	const choices = parts.map(literalChoice);
	if (parts.length > 1 && choices.every((choice) => choice !== null)) {
		return { choices: choices.filter((c) => c !== null), kind: 'enum' };
	}

	if (parts.length > 1) {
		return {
			kind: 'union',
			variants: parts.map((part) => single(part, checker, depth, seen))
		};
	}

	const [only] = parts;

	return only ? single(only, checker, depth, seen) : opaque();
};

const single = (
	type: ts.Type,
	checker: ts.TypeChecker,
	depth: number,
	seen: Set<ts.Type>
): FieldSchema => {
	const opaque = (): FieldSchema => ({
		kind: 'opaque',
		typeText: checker.typeToString(type)
	});

	if (hasFlag(type, ts.TypeFlags.BooleanLike)) return { kind: 'boolean' };
	if (hasFlag(type, ts.TypeFlags.NumberLike)) return { kind: 'number' };
	if (hasFlag(type, ts.TypeFlags.StringLike)) return { kind: 'string' };
	if (!hasFlag(type, ts.TypeFlags.Object)) return opaque();

	// Functions / class instances aren't structure-editable.
	if (type.getCallSignatures().length > 0) return opaque();

	const element = type.getNumberIndexType();
	const stringIndex = type.getStringIndexType();
	const props = checker.getPropertiesOfType(type);

	// Arrays: a number index and no own named properties.
	if (element && props.length === 0) {
		return {
			item: toSchema(element, checker, depth + 1, seen),
			kind: 'array'
		};
	}

	if (seen.has(type)) return opaque();
	seen.add(type);
	try {
		if (props.length > 0) {
			const fields: FieldNode[] = props.map((symbol) => ({
				description: docOf(symbol, checker),
				name: symbol.getName(),
				optional: (symbol.flags & ts.SymbolFlags.Optional) !== 0,
				schema: toSchema(
					typeOfSymbol(symbol, checker),
					checker,
					depth + 1,
					seen
				)
			}));

			return { fields, kind: 'object' };
		}
		if (stringIndex) {
			return {
				kind: 'record',
				value: toSchema(stringIndex, checker, depth + 1, seen)
			};
		}
	} finally {
		seen.delete(type);
	}

	return opaque();
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

	const nodes: FieldNode[] = [];
	sourceFile.forEachChild((node) => {
		if (!ts.isVariableStatement(node)) return;
		const declaration = node.declarationList.declarations[0];
		if (!declaration) return;
		const type = checker.getTypeAtLocation(declaration);
		for (const symbol of checker.getPropertiesOfType(type)) {
			const name = symbol.getName();
			if (exclude.has(name) || name.startsWith('__')) continue;
			nodes.push({
				description: docOf(symbol, checker),
				name,
				optional: (symbol.flags & ts.SymbolFlags.Optional) !== 0,
				schema: toSchema(
					typeOfSymbol(symbol, checker),
					checker,
					1,
					new Set()
				)
			});
		}
	});

	return nodes.sort((left, right) => left.name.localeCompare(right.name));
};

const cache = new Map<string, FieldNode[]>();

// Recover a recursive shape (objects, arrays, records, enums, unions) from a
// TypeScript type that is otherwise erased at runtime — the source of truth for
// the config editors, so it can't drift. Resolves from the installed
// `@absolutejs/absolute`, with a local-barrel fallback inside the framework repo.
export const introspectType = (
	cwd: string,
	typeName: string,
	exclude: Set<string> = new Set(),
	specifier = '@absolutejs/absolute'
) => {
	const cacheKey = `${specifier}:${typeName}`;
	const cached = cache.get(cacheKey);
	if (cached) return cached;

	const local =
		specifier === '@absolutejs/absolute' &&
		isFrameworkRepo(cwd) &&
		existsSync(resolve(cwd, 'types/index.ts'));
	const signature = cacheSignature(cwd, typeName, local, specifier);
	const fromDisk = readDiskCache(cwd, typeName, signature, specifier);
	if (fromDisk) {
		cache.set(cacheKey, fromDisk);

		return fromDisk;
	}

	const options = compilerOptionsFor(cwd);
	const specifiers = local ? [specifier, './types'] : [specifier];

	for (const candidate of specifiers) {
		try {
			const nodes = introspectFrom(
				cwd,
				candidate,
				typeName,
				options,
				exclude
			);
			if (nodes.length > 0) {
				cache.set(cacheKey, nodes);
				writeDiskCache(cwd, typeName, signature, nodes, specifier);

				return nodes;
			}
		} catch {
			/* try the next specifier */
		}
	}

	cache.set(cacheKey, []);

	return cache.get(cacheKey) ?? [];
};
