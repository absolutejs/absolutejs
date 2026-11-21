import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: 'Soft navigation into an Angular page and back out of it is now covered, including the teardown that is specific to Angular: `compileAngular` registers an async dispose hook that awaits the page-ready promise and then destroys the application, so without the layer awaiting it a zone, a change-detection loop and the whole injector tree would keep running against a body that is gone. The test asserts `__ANGULAR_APP__` is live on arrival and gone after leaving — both directions, because "destroyed" alone would also pass if the global were never set — that the page is interactive before leaving rather than just swapped in, and that no document is requested either way. Nothing needed changing in the framework. The test is driven as a real installed app, with the fixture in a temp directory, this checkout\'s node_modules symlinked in and the app started through dist/cli/index.js: an earlier attempt that called the Angular page handler in-process failed every SSR render with NG0203 before reaching any navigation code, and importing the injector patch first did not help. Why the in-process path breaks Angular\'s injector is still unknown, which is recorded in the plan so the harness is not simplified back into the broken shape.',
	kind: 'internal',
	summary:
		'Angular is a verified row in the cross-framework navigation matrix'
};
