import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import ts from 'typescript';

const compileTypeFixture = (source: string) => {
	const fileName = join(
		process.cwd(),
		'tests',
		'.generated',
		'angular-page-handler-types.ts'
	);
	const options: ts.CompilerOptions = {
		lib: ['lib.esnext.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'],
		module: ts.ModuleKind.ESNext,
		moduleResolution: ts.ModuleResolutionKind.Bundler,
		noEmit: true,
		skipLibCheck: true,
		strict: true,
		target: ts.ScriptTarget.ESNext,
		types: ['bun']
	};
	const host = ts.createCompilerHost(options);
	const defaultGetSourceFile = host.getSourceFile.bind(host);

	host.getSourceFile = (
		requestedFileName,
		languageVersion,
		onError,
		shouldCreateNewSourceFile
	) => {
		if (requestedFileName === fileName) {
			return ts.createSourceFile(
				requestedFileName,
				source,
				languageVersion,
				true
			);
		}

		return defaultGetSourceFile(
			requestedFileName,
			languageVersion,
			onError,
			shouldCreateNewSourceFile
		);
	};

	const program = ts.createProgram([fileName], options, host);

	return ts
		.getPreEmitDiagnostics(program)
		.filter((diagnostic) => diagnostic.file?.fileName === fileName)
		.map((diagnostic) =>
			ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')
		);
};

describe('Angular page handler types', () => {
	test('allows omitted props for no-prop pages and preserves required props', () => {
		const diagnostics = compileTypeFixture(`
			import type { AngularPageRequestInput } from '../../src/angular/pageHandler';
			import type { AngularPageDefinition } from '../../types/angular';

			type OptionalAnyPage = {
				page: AngularPageDefinition<any>;
			};
			const optionalAnyInput: AngularPageRequestInput<OptionalAnyPage> = {
				indexPath: '/index.js',
				pagePath: '/home.js'
			};
			void optionalAnyInput;

			type NoArgPage = {
				page: AngularPageDefinition;
			};
			const noArgInput: AngularPageRequestInput<NoArgPage> = {
				indexPath: '/index.js',
				pagePath: '/home.js'
			};
			void noArgInput;

			type RequiredPropsPage = {
				page: AngularPageDefinition<{ id: string }>;
			};
			// @ts-expect-error props are required when the page declaration has required typed props.
			const missingRequiredProps: AngularPageRequestInput<RequiredPropsPage> = {
				indexPath: '/index.js',
				pagePath: '/profile.js'
			};
			void missingRequiredProps;

			const requiredPropsInput: AngularPageRequestInput<RequiredPropsPage> = {
				indexPath: '/index.js',
				pagePath: '/profile.js',
				props: { id: 'profile-1' }
			};
			void requiredPropsInput;
		`);

		expect(diagnostics).toEqual([]);
	}, 15_000);
});
