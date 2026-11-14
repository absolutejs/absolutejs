/* zone.js cannot see native `async`/`await`: the code after an `await`
 * resumes outside the Angular zone, so change detection never runs for
 * it and server rendering does not wait for timers it schedules. The
 * Angular CLI downlevels async functions for zone apps for this reason.
 * In zone mode, the compiled Angular output gets the same treatment:
 * TypeScript at ES2016 turns `async`/`await` into generators driven by
 * the (zone-patched) global Promise. Code without `async` is returned
 * untouched. */
import { ts } from '../utils/lazyTypescript';
import { isAngularZoneMode } from '../angular/zoneRuntime';

const ASYNC_KEYWORD = /\basync\b/;

export const downlevelAsyncForZone = (code: string, fileName: string) => {
	if (!isAngularZoneMode() || !ASYNC_KEYWORD.test(code)) return code;

	return ts.transpileModule(code, {
		compilerOptions: {
			importHelpers: false,
			module: ts.ModuleKind.ESNext,
			sourceMap: false,
			target: ts.ScriptTarget.ES2016,
			useDefineForClassFields: false
		},
		fileName: fileName.replace(/\.[cm]?[tj]sx?$/, '.js')
	}).outputText;
};
