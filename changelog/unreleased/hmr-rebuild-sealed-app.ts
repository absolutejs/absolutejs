import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: 'An entry that builds its app over several statements (`const app = new Elysia(); app.use(projects); app.use(billing); export const server = app.use(networking)`) could not take a hot update to one of those pieces. Re-running `app.use(billing)` called `.use()` on the kept app, which Elysia seals at its first request, so the update failed with "[Elysia] .use() called after the app was sealed by its first request" and the old code kept serving until a restart. The analyzer now records statements that call an Elysia builder method (`use`, `get`, `post`, `group`, `guard`, `derive`, `onStop`, …) on a top-level app, and when one re-runs the app is rebuilt: its declaration and every statement that builds it re-run in order, as at boot. Other method calls (`db.execute()` and the like) never rebuild what they are called on.',
	kind: 'fixed',
	summary: 'Hot updates work for an app built over several `.use(…)` statements after its first request'
};
