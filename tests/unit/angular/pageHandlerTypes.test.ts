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
	test('typechecks requestContext against the caller-supplied Ctx generic', () => {
		const diagnostics = compileTypeFixture(`
			import type { AngularPageRequestInput } from '../../src/angular/pageHandler';

			const noCtxInput: AngularPageRequestInput = {
				indexPath: '/index.js',
				pagePath: '/home.js'
			};
			void noCtxInput;

			type RequiredCtx = { id: string };
			// @ts-expect-error requestContext is required when Ctx has required keys.
			const missingRequiredCtx: AngularPageRequestInput<RequiredCtx> = {
				indexPath: '/index.js',
				pagePath: '/profile.js'
			};
			void missingRequiredCtx;

			const requiredCtxInput: AngularPageRequestInput<RequiredCtx> = {
				indexPath: '/index.js',
				pagePath: '/profile.js',
				requestContext: { id: 'profile-1' }
			};
			void requiredCtxInput;

			type OptionalCtx = { id?: string };
			const optionalCtxInput: AngularPageRequestInput<OptionalCtx> = {
				indexPath: '/index.js',
				pagePath: '/profile.js'
			};
			void optionalCtxInput;

			type NullableCtx = { id: string | null };
			// @ts-expect-error null in the field type does not flip requestContext to optional.
			const missingNullableCtx: AngularPageRequestInput<NullableCtx> = {
				indexPath: '/index.js',
				pagePath: '/profile.js'
			};
			void missingNullableCtx;

			const nullableCtxInput: AngularPageRequestInput<NullableCtx> = {
				indexPath: '/index.js',
				pagePath: '/profile.js',
				requestContext: { id: null }
			};
			void nullableCtxInput;

			const extraKeyInput: AngularPageRequestInput<RequiredCtx> = {
				indexPath: '/index.js',
				pagePath: '/profile.js',
				// @ts-expect-error unknown keys are rejected by the standard excess-property check.
				requestContext: { id: 'profile-1', mystery: 'oops' }
			};
			void extraKeyInput;
		`);

		expect(diagnostics).toEqual([]);
	}, 15_000);
});
