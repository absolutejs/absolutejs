import { describe, expect, test } from 'bun:test';
import { splitAngularRoutePages } from '../../../src/angular/splitRoutePages';

const page = (
	routes: string,
	extra = ''
) => `import { Component } from '@angular/core';
import { RouterOutlet, type Routes } from '@angular/router';
import { HomeComponent } from '../../components/home/home';
import { ProfileComponent, profileTitle } from '../../components/profile/profile';
import { ShellComponent } from '../../components/shell/shell';${extra}

export const routes: Routes = ${routes};

@Component({ imports: [RouterOutlet], selector: 'app-spa', template: '<router-outlet />' })
export class SpaComponent {
	title = profileTitle;
}
`;

const split = (source: string) => splitAngularRoutePages(source, 'spa.ts');

describe('Angular router pages load lazily', () => {
	test('a leaf route component imported from the app becomes loadComponent', () => {
		const out =
			split(
				page(
					`[{ component: HomeComponent, path: '' }, { component: ProfileComponent, path: 'profile' }]`
				)
			) ?? '';

		expect(out).toContain(
			`loadComponent: () => import("../../components/home/home").then((m) => m.HomeComponent), path: ''`
		);
		expect(out).toContain(
			`loadComponent: () => import("../../components/profile/profile").then((m) => m.ProfileComponent), path: 'profile'`
		);
		expect(out).not.toContain(`import { HomeComponent }`);
		// The rest of an import stays.
		expect(out).toContain(
			`import { profileTitle } from '../../components/profile/profile';`
		);
	});

	test('a layout route keeps its component; its children are split', () => {
		const out =
			split(
				page(
					`[{ component: ShellComponent, path: 'app', children: [{ component: HomeComponent, path: '' }] }]`
				)
			) ?? '';

		expect(out).toContain('component: ShellComponent,');
		expect(out).toContain(
			`loadComponent: () => import("../../components/home/home")`
		);
	});

	test('the class name in a string or comment is not a use', () => {
		const source = page(`[{ component: HomeComponent, path: '' }]`).replace(
			"template: '<router-outlet />'",
			"template: '<a>HomeComponent</a><router-outlet />' /* HomeComponent */"
		);

		expect(split(source)).toContain(
			'loadComponent: () => import("../../components/home/home")'
		);
	});

	test('a component also listed in @Component imports stays eager', () => {
		const source = page(`[{ component: HomeComponent, path: '' }]`).replace(
			'imports: [RouterOutlet]',
			'imports: [RouterOutlet, HomeComponent]'
		);

		expect(split(source)).toBeNull();
	});

	test('routes passed straight to provideRouter are split too', () => {
		const source = `import { provideRouter } from '@angular/router';
import { HomeComponent } from './home';
export const providers = [provideRouter([{ component: HomeComponent, path: '' }])];
`;

		expect(split(source)).toContain(
			`loadComponent: () => import("./home").then((m) => m.HomeComponent)`
		);
	});

	test('a component from a package or declared in the file is left alone', () => {
		const source = `import { type Routes } from '@angular/router';
import { DocsComponent } from '@acme/docs';
class LocalComponent {}
export const routes: Routes = [{ component: DocsComponent, path: 'docs' }, { component: LocalComponent, path: 'x' }];
`;

		expect(split(source)).toBeNull();
	});
});
