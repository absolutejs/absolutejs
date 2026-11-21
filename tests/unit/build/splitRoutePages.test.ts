import { describe, expect, test } from 'bun:test';
import { splitRoutePages } from '../../../src/build/splitRoutePages';

const transpiles = (code: string) =>
	new Bun.Transpiler({ loader: 'tsx' }).transformSync(code).length > 0;

const ROUTES = `import { Route, Routes } from 'react-router';
import { Billing } from './Billing';
import Account from './Account';
import { Layout } from './Layout';

export const AppRoutes = () => (
	<Routes>
		<Route element={<Layout />} path="/">
			<Route element={<Billing />} path="/billing" />
			<Route element={<Account plan="pro" />} path="/account" />
		</Route>
	</Routes>
);
`;

describe('route pages load lazily', () => {
	test('a leaf route page imported from the app becomes a lazy route', () => {
		const out = splitRoutePages(ROUTES, 'Routes.tsx') ?? '';

		expect(out).toContain(
			`const Billing = __absoluteLazyRoute(() => import("./Billing"), "Billing");`
		);
		expect(out).toContain(
			`const Account = __absoluteLazyRoute(() => import("./Account"), "default");`
		);
		expect(out).toContain(
			`import { lazyRoute as __absoluteLazyRoute } from "@absolutejs/absolute/react/router";`
		);
		expect(out).not.toContain(`import { Billing } from './Billing';`);
		expect(out).not.toContain(`import Account from './Account';`);
		// The JSX is untouched; props still pass through.
		expect(out).toContain('<Account plan="pro" />');
		expect(transpiles(out)).toBe(true);
	});

	test('a layout route (one with child routes) stays in the entry', () => {
		const out = splitRoutePages(ROUTES, 'Routes.tsx') ?? '';

		expect(out).toContain(`import { Layout } from './Layout';`);
		expect(out).not.toContain('const Layout =');
	});

	test('a page the file also uses elsewhere stays eager', () => {
		const source = `import { Route, Routes } from 'react-router';
import { Billing } from './Billing';
export const Preview = () => <Billing />;
export const AppRoutes = () => (
	<Routes><Route element={<Billing />} path="/billing" /></Routes>
);
`;

		expect(splitRoutePages(source, 'Routes.tsx')).toBeNull();
	});

	test('a page from a package stays eager', () => {
		const source = `import { Route, Routes } from 'react-router';
import { Docs } from '@acme/docs';
export const AppRoutes = () => <Routes><Route element={<Docs />} path="/docs" /></Routes>;
`;

		expect(splitRoutePages(source, 'Routes.tsx')).toBeNull();
	});

	test('other bindings of the same import are kept', () => {
		const source = `import { Route, Routes } from 'react-router';
import { Billing, billingTitle } from './Billing';
export const title = billingTitle;
export const AppRoutes = () => <Routes><Route element={<Billing />} path="/billing" /></Routes>;
`;
		const out = splitRoutePages(source, 'Routes.tsx') ?? '';

		expect(out).toContain(`import { billingTitle } from './Billing';`);
		expect(out).toContain('const Billing = __absoluteLazyRoute(');
		expect(transpiles(out)).toBe(true);
	});

	test('an aliased Route, and a page written with a closing tag', () => {
		const source = `import { Route as R, Routes } from 'react-router-dom';
import { Billing } from './Billing';
export const AppRoutes = () => <Routes><R element={<Billing></Billing>} path="/billing" /></Routes>;
`;
		const out = splitRoutePages(source, 'Routes.tsx') ?? '';

		expect(out).toContain('const Billing = __absoluteLazyRoute(');
		expect(transpiles(out)).toBe(true);
	});

	test("a 'use client' directive stays first", () => {
		const out = splitRoutePages(`'use client';\n${ROUTES}`, 'Routes.tsx') ?? '';

		expect(out.startsWith(`'use client';`)).toBe(true);
		expect(transpiles(out)).toBe(true);
	});

	test('a file with no router is left alone', () => {
		expect(
			splitRoutePages(`import { Billing } from './Billing';\nexport const X = () => <Billing />;`, 'X.tsx')
		).toBeNull();
	});
});
