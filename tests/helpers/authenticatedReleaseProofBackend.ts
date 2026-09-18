import { Database } from 'bun:sqlite';
import { randomUUID } from 'node:crypto';
import { Elysia } from 'elysia';
import {
	auth,
	createInMemoryAuthSessionStore,
	createInMemoryAuthorizationCodeStore,
	createInMemoryOAuthClientStore,
	createInMemoryOidcRefreshTokenStore,
	createInMemorySocketTicketStore,
	generateSigningKey
} from '@absolutejs/auth';
import { syncSocket } from '@absolutejs/sync';
import {
	createSyncEngine,
	defineCollection,
	defineMutation,
	type DurableMutationRunner
} from '@absolutejs/sync/engine';

export type AuthenticatedProofRow = {
	id: string;
	owner: string;
	value: string;
};
type SyntheticUser = { sub: string; email: string };
type ProofOptions = {
	challenge: string;
	origin: string;
	appId: string;
	database?: string;
};
const users: SyntheticUser[] = [
	{ email: 'account-a@example.test', sub: 'account-a' },
	{ email: 'account-b@example.test', sub: 'account-b' }
];
const subject = (context: unknown) => {
	const user =
		context && typeof context === 'object' && Reflect.get(context, 'user');
	const sub = user && typeof user === 'object' && Reflect.get(user, 'sub');
	if (!users.some((candidate) => candidate.sub === sub))
		throw new Error('Unauthenticated proof request');

	return sub as string;
};

/** Synthetic, loopback-only harness backend. Never mount this in a real app. */
export const createAuthenticatedReleaseProofBackend = async ({
	challenge,
	origin,
	appId,
	database = ':memory:'
}: ProofOptions) => {
	const issuer = new URL(origin);
	if (
		issuer.protocol !== 'https:' ||
		issuer.hostname !== 'localhost' ||
		issuer.pathname !== '/'
	)
		throw new Error(
			'Authenticated proof requires an HTTPS localhost origin'
		);
	const db = new Database(database);
	db.exec(
		'PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS proof_rows (id TEXT PRIMARY KEY, owner TEXT NOT NULL, value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS proof_receipts (scope TEXT NOT NULL, operation TEXT NOT NULL, fingerprint TEXT NOT NULL, result TEXT NOT NULL, PRIMARY KEY(scope, operation));'
	);
	let tail = Promise.resolve();
	const run: DurableMutationRunner = (operation, execute) => {
		const task = tail.then(async () => {
			const fingerprint = JSON.stringify([
				operation.name,
				operation.args
			]);
			db.exec('BEGIN IMMEDIATE');
			try {
				const receipt = db
					.query<
						{ fingerprint: string; result: string },
						[string, string]
					>('SELECT fingerprint, result FROM proof_receipts WHERE scope = ? AND operation = ?')
					.get(operation.scope, operation.operationId);
				if (receipt) {
					if (receipt.fingerprint !== fingerprint)
						throw new Error('Proof operation identity reused');
					db.exec('COMMIT');

					return {
						replayed: true,
						result: JSON.parse(receipt.result)
					};
				}
				const result = await execute(db);
				db.query('INSERT INTO proof_receipts VALUES (?, ?, ?, ?)').run(
					operation.scope,
					operation.operationId,
					fingerprint,
					JSON.stringify(result)
				);
				db.exec('COMMIT');

				return { replayed: false, result };
			} catch (error) {
				db.exec('ROLLBACK');
				throw error;
			}
		});
		tail = task.then(
			() => undefined,
			() => undefined
		);

		return task;
	};
	const engine = createSyncEngine({
		durableMutations: { run, scope: subject }
	});
	engine.register(
		defineCollection<AuthenticatedProofRow>({
			name: 'authenticated-proof',
			authorize: (_params, context) => {
				subject(context);

				return true;
			},
			hydrate: (_params, context) =>
				db
					.query<
						AuthenticatedProofRow,
						[string]
					>('SELECT * FROM proof_rows WHERE owner = ?')
					.all(subject(context)),
			match: (row, _params, context) => row.owner === subject(context)
		})
	);
	engine.registerWriter('authenticated-proof', {
		delete: () => {
			throw new Error('Unsupported proof operation');
		},
		insert: (_data, context, transaction) => {
			if (transaction !== db)
				throw new Error(
					'Proof write requires an atomic receipt transaction'
				);
			const row: AuthenticatedProofRow = {
				id: randomUUID(),
				owner: subject(context),
				value: challenge
			};
			db.query('INSERT INTO proof_rows VALUES (?, ?, ?)').run(
				row.id,
				row.owner,
				row.value
			);

			return row;
		},
		update: () => {
			throw new Error('Unsupported proof operation');
		}
	});
	engine.registerMutation(
		defineMutation<{ challenge: string }>({
			name: 'recordAuthenticatedProof',
			handler: (args, context, actions) => {
				subject(context);
				if (args.challenge !== challenge)
					throw new Error('Wrong proof challenge');

				return actions.insert('authenticated-proof', {});
			}
		})
	);
	const sessions = createInMemoryAuthSessionStore<SyntheticUser>();
	const sessionIds = new Map<string, ReturnType<typeof randomUUID>>();
	const authPlugin = await auth<SyntheticUser>({
		authSessionStore: sessions,
		cookieSecure: true,
		oidc: {
			authorizationCodeStore: createInMemoryAuthorizationCodeStore(),
			clientStore: createInMemoryOAuthClientStore([
				{
					clientId: `absolutejs-native:${appId}`,
					name: 'Synthetic release acceptance',
					redirectUris: [`${appId}://auth/callback`],
					scopes: ['openid', 'profile']
				}
			]),
			issuer: origin,
			loginUrl: `${origin}/__proof/login`,
			refreshTokenStore: createInMemoryOidcRefreshTokenStore(),
			signingKey: await generateSigningKey(),
			socketTicketStore: createInMemorySocketTicketStore(),
			getClaims: (user) => ({ email: user.email }),
			getUserId: (user) => user.sub,
			getUserInfo: async (sub) => users.find((user) => user.sub === sub),
			onAuthorizationCodeApproved: async ({ userSub }) => {
				// Each synthetic browser authorization requires an explicit account
				// selection; a previous test login must not select the next account.
				const id = sessionIds.get(userSub);
				if (id) await sessions.removeSession(id);
			}
		},
		providersConfiguration: {},
		getUser: (sub) => users.find((user) => user.sub === sub) ?? null
	});
	const logins = new Map<string, { expires: number; returnTo: string }>();
	const facts = () => ({
		challenge,
		rows: db
			.query<
				AuthenticatedProofRow,
				[]
			>('SELECT * FROM proof_rows ORDER BY rowid')
			.all(),
		writes:
			db
				.query<
					{ count: number },
					[]
				>('SELECT COUNT(*) AS count FROM proof_rows')
				.get()?.count ?? 0
	});
	let syncEnabled = true;
	const app = new Elysia().request(({ request }) => {
		const path = new URL(request.url).pathname;
		if (
			!syncEnabled &&
			(path === '/sync/ws' || path.startsWith('/__absolute/sync/'))
		)
			return new Response('Synthetic Sync partition', {
				status: 503
			});

		return undefined;
	});
	// This harness has no Eden consumer. Keep plugin assembly on the base
	// instance instead of exporting Auth's entire inferred route graph.
	app.use(authPlugin);
	app.use(syncSocket({ engine }));
	app.get('/__proof', facts)
		.post('/__proof/sync-gate', { parse: 'none' }, async ({ request }) => {
			if (request.headers.get('x-proof-control') !== challenge)
				return new Response(null, { status: 403 });
			const value = await request.text();
			if (value !== 'open' && value !== 'closed')
				return new Response(null, { status: 400 });
			syncEnabled = value === 'open';

			return { syncEnabled };
		})
		.get('/__proof/login', ({ request }) => {
			const returnTo = new URL(request.url).searchParams.get('return_to');
			if (!returnTo)
				return new Response('Missing return target', { status: 400 });
			const target = new URL(returnTo, origin);
			if (
				target.origin !== issuer.origin ||
				target.pathname !== '/oauth2/authorize'
			)
				return new Response('Invalid return target', { status: 400 });
			const nonce = randomUUID();
			logins.set(nonce, {
				expires: Date.now() + 120_000,
				returnTo: target.href
			});

			return new Response(
				`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><h1>Synthetic release test</h1><form method="post" action="/__proof/login"><input type="hidden" name="nonce" value="${nonce}"><button name="account" value="account-a">Authorize account A</button><button name="account" value="account-b">Authorize account B</button></form>`,
				{
					headers: {
						'Cache-Control': 'no-store',
						'Content-Type': 'text/html'
					}
				}
			);
		})
		.post('/__proof/login', { parse: 'none' }, async ({ request }) => {
			if (request.headers.get('origin') !== issuer.origin)
				return new Response('Invalid origin', { status: 403 });
			if (
				!request.headers
					.get('content-type')
					?.startsWith('application/x-www-form-urlencoded')
			)
				return new Response('Expected a login form', { status: 415 });
			const form = new URLSearchParams(await request.text());
			const nonce = String(form.get('nonce'));
			const login = logins.get(nonce);
			logins.delete(nonce);
			const user = users.find(
				(candidate) => candidate.sub === form.get('account')
			);
			if (!login || login.expires < Date.now() || !user)
				return new Response('Invalid synthetic login', { status: 400 });
			const id = randomUUID();
			await sessions.setSession(id, {
				authenticatedAt: Date.now(),
				expiresAt: Date.now() + 120_000,
				user
			});
			sessionIds.set(user.sub, id);

			return new Response(null, {
				headers: {
					'Cache-Control': 'no-store',
					Location: login.returnTo,
					'Set-Cookie': `user_session_id=${id}; Path=/; HttpOnly; Secure; SameSite=Lax`
				},
				status: 303
			});
		});

	return {
		app,
		engine,
		facts,
		close: async () => {
			await tail;
			db.close();
		}
	};
};
