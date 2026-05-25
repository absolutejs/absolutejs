/* HMR-specific `ImportGenerator` for the vendored translator.
 *
 * Angular's translator (in `vendor/translator/`) calls
 * `imports.addImport({ exportSymbolName, exportModuleSpecifier, … })`
 * every time it walks an `o.ExternalExpr` (e.g. `@angular/core`'s
 * `ɵɵdefineComponent`). Whatever `ts.Expression` we return is
 * substituted in-line at the call site.
 *
 * Modeled after `compiler-cli`'s `HmrModuleImportRewriter` +
 * `presetImportManagerForceNamespaceImports`, but flattened — HMR
 * update modules cannot contain top-level imports (they're function
 * bodies, not modules), so every external symbol comes in via the
 * `ɵɵnamespaces` parameter and we resolve to a property access on
 * the local namespace alias. */

import ts from 'typescript';
import type {
	ImportGenerator,
	ImportRequest
} from './vendor/translator/api/import_generator';

export const createHmrImportGenerator = (
	namespaceMap: Map<string, string>
): ImportGenerator<ts.SourceFile, ts.Expression> => ({
	addImport(request: ImportRequest<ts.SourceFile>) {
		const ns = namespaceMap.get(request.exportModuleSpecifier);
		if (!ns) {
			throw new Error(
				`HMR import generator has no namespace mapping for ${request.exportModuleSpecifier}. ` +
					`Add it to namespaceDependencies before calling compileHmrUpdateCallback.`
			);
		}
		const namespaceId = ts.factory.createIdentifier(ns);
		if (request.exportSymbolName === null) {
			// Whole-namespace import — return the identifier itself.
			return namespaceId;
		}

		return ts.factory.createPropertyAccessExpression(
			namespaceId,
			ts.factory.createIdentifier(request.exportSymbolName)
		);
	}
});
