import { describe, expect, test } from 'bun:test';
import { ANGULAR_LINKER_CANDIDATE_RE } from '../../../src/build/angularLinkerPlugin';

describe('angularLinkerPlugin', () => {
	test('processes node_modules packages and skips app source', () => {
		expect(
			ANGULAR_LINKER_CANDIDATE_RE.test(
				'/app/node_modules/@angular/common/fesm2022/common.mjs'
			)
		).toBe(true);
		expect(
			ANGULAR_LINKER_CANDIDATE_RE.test(
				'/app/node_modules/@absolutejs/absolute/dist/angular/components/image.component.js'
			)
		).toBe(true);
		expect(
			ANGULAR_LINKER_CANDIDATE_RE.test(
				'/app/node_modules/ngx-markdown/fesm2022/ngx-markdown.mjs'
			)
		).toBe(true);
		expect(
			ANGULAR_LINKER_CANDIDATE_RE.test('/app/src/frontend/page.ts')
		).toBe(false);
	});
});
