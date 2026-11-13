/* Runs in its own process (zone.js patches it globally). Prints one JSON
 * line: Elysia responses under zone.js and Angular zone-mode SSR output.
 * Usage: bun zoneProbe.ts <port> */
import { installAngularZoneRuntime } from '../../../src/angular/zoneRuntime';
import { downlevelAsyncForZone } from '../../../src/build/downlevelAsyncForZone';

const port = Number(process.argv[2]);

await installAngularZoneRuntime();
await import('@angular/compiler');
const { Component, provideZoneChangeDetection } = await import('@angular/core');
const { bootstrapApplication } = await import('@angular/platform-browser');
const { provideServerRendering, renderApplication } =
	await import('@angular/platform-server');
const { Elysia } = await import('elysia');

const app = new Elysia()
	.get('/async', async () => {
		await Bun.sleep(1);

		return { ok: true };
	})
	.get('/sync', () => 'sync')
	.listen(port);

const readRoute = async (path: string) => {
	const response = await fetch(`http://localhost:${port}${path}`);

	return response.text();
};

// Class source the way compiled Angular output carries it: native async.
const componentSource = `return class {
	note = 'pending';
	async ngOnInit() {
		await Promise.resolve();
		await new Promise((resolve) => setTimeout(resolve, 20));
		this.note = 'resolved after await';
	}
};`;

const isClass = (value: unknown): value is new () => unknown =>
	typeof value === 'function';

const renderNote = async (source: string) => {
	const Page: unknown = new Function(source)();
	if (!isClass(Page)) throw new Error('bad class');
	// The decorator registers the component definition on the class.
	Component({
		selector: 'zone-probe',
		standalone: true,
		template: '<p>{{ note }}</p>'
	})(Page);
	const html = await renderApplication(
		(context) =>
			bootstrapApplication(
				Page,
				{
					providers: [
						provideServerRendering(),
						provideZoneChangeDetection({ eventCoalescing: true })
					]
				},
				context
			),
		{
			document:
				'<html><head></head><body><zone-probe></zone-probe></body></html>',
			url: '/'
		}
	);

	return /<p>([^<]*)<\/p>/.exec(html)?.[1] ?? null;
};

type ProbeResult = {
	asyncRoute: string;
	downleveledNote: string | null;
	nativeAsyncNote: string | null;
	promiseName: string;
	syncRoute: string;
};

const result: ProbeResult = {
	asyncRoute: await readRoute('/async'),
	downleveledNote: await renderNote(
		downlevelAsyncForZone(componentSource, 'probe.js')
	),
	nativeAsyncNote: await renderNote(componentSource),
	promiseName: globalThis.Promise.name,
	syncRoute: await readRoute('/sync')
};
console.log(JSON.stringify(result));
await app.stop();
process.exit(0);
