// The official Elysia integrations `absolute add <id>` (and the config:studio
// Integrations panel) can install + wire. `config`-kind integrations are mounted
// by the AbsoluteJS runtime when their absolute.config field is set — installing
// is just a dependency + a flag. `use`-kind integrations are added to the user's
// own server with a `.use(...)`, so we install the package and hand back the exact
// import + use lines rather than editing their entry file.

export type IntegrationWiring =
	| { field: string; kind: 'config' }
	| { importLine: string; kind: 'use'; useLine: string };

type IntegrationMeta = {
	blurb: string;
	id: string;
	label: string;
	note?: string;
	packages: string[];
	wiring: IntegrationWiring;
};

export const INTEGRATIONS: IntegrationMeta[] = [
	{
		blurb: 'Auto-derived OpenAPI docs + Scalar/Swagger UI from your route schemas.',
		id: 'openapi',
		label: 'OpenAPI',
		packages: [],
		wiring: { field: 'openapi', kind: 'config' }
	},
	{
		blurb: 'Production distributed tracing via OpenTelemetry (complements `absolute inspect`).',
		id: 'telemetry',
		label: 'OpenTelemetry',
		packages: ['@elysiajs/opentelemetry'],
		wiring: { field: 'telemetry', kind: 'config' }
	},
	{
		blurb: 'Cross-origin resource sharing (CORS) headers.',
		id: 'cors',
		label: '@elysiajs/cors',
		packages: ['@elysiajs/cors'],
		wiring: {
			importLine: "import { cors } from '@elysiajs/cors';",
			kind: 'use',
			useLine: '.use(cors())'
		}
	},
	{
		blurb: 'Sign and verify your own JWTs — custom API/service tokens.',
		id: 'jwt',
		label: '@elysiajs/jwt',
		note: 'Not for user login. For authentication (OAuth2, SSO, MFA, passkeys, sessions) use the Auth panel + @absolutejs/auth.',
		packages: ['@elysiajs/jwt'],
		wiring: {
			importLine: "import { jwt } from '@elysiajs/jwt';",
			kind: 'use',
			useLine: ".use(jwt({ name: 'jwt', secret: getEnv('JWT_SECRET') }))"
		}
	},
	{
		blurb: 'Scheduled jobs on a cron pattern.',
		id: 'cron',
		label: '@elysiajs/cron',
		packages: ['@elysiajs/cron'],
		wiring: {
			importLine: "import { cron } from '@elysiajs/cron';",
			kind: 'use',
			useLine:
				".use(cron({ name: 'heartbeat', pattern: '0 */6 * * *', run() {} }))"
		}
	}
];

export const findIntegration = (id: string) =>
	INTEGRATIONS.find((integration) => integration.id === id) ?? null;

export const isIntegrationId = (value: string) =>
	INTEGRATIONS.some((integration) => integration.id === value);
