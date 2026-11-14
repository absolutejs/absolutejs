/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.dev/license
 */

import * as o from '@angular/compiler';
import type TS from 'typescript';
import { ts } from '../../../../utils/lazyTypescript';

import { ImportGenerator } from './api/import_generator';
import { Context } from './context';
import { ExpressionTranslatorVisitor, TranslatorOptions } from './translator';
import { TypeScriptAstFactory } from './typescript_ast_factory';

export function translateExpression(
	contextFile: TS.SourceFile,
	expression: o.Expression,
	imports: ImportGenerator<TS.SourceFile, TS.Expression>,
	options: TranslatorOptions<TS.Expression> = {}
): TS.Expression {
	return expression.visitExpression(
		new ExpressionTranslatorVisitor<
			TS.SourceFile,
			TS.Statement,
			TS.Expression,
			TS.TypeNode
		>(
			new TypeScriptAstFactory(
				options.annotateForClosureCompiler === true
			),
			imports,
			contextFile,
			options
		),
		new Context(false)
	);
}

export function translateStatement(
	contextFile: TS.SourceFile,
	statement: o.Statement,
	imports: ImportGenerator<TS.SourceFile, TS.Expression>,
	options: TranslatorOptions<TS.Expression> = {}
): TS.Statement {
	return statement.visitStatement(
		new ExpressionTranslatorVisitor<
			TS.SourceFile,
			TS.Statement,
			TS.Expression,
			TS.TypeNode
		>(
			new TypeScriptAstFactory(
				options.annotateForClosureCompiler === true
			),
			imports,
			contextFile,
			options
		),
		new Context(true)
	);
}
