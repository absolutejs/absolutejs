import { Elysia } from 'elysia';
import type { RevalidateRequestResult } from '../../types/revalidate';
import { logWarn } from '../utils/logger';
import { constantTimeEquals } from '../utils/signingSecret';
import { revalidateRequested } from './revalidate';

/* `POST /__absolute/revalidate`: revalidation for something that is not
 * the app.
 *
 * `revalidatePath` and `revalidateTag` are functions, so only code
 * running in the server can call them. The thing that knows a post
 * changed is often somewhere else — a CMS, a job, another service — and
 * what it can do is send a request. This is the request.
 *
 * It is a public URL that makes the server render pages, so it is built
 * to be hard to misuse:
 *
 * - it does not exist unless `static.revalidateToken` is set, and a
 *   token too short to be a secret is treated as not set;
 * - the token is compared in constant time, and a wrong one learns
 *   nothing about what would have happened;
 * - one call names a bounded number of paths and tags, so a caller with
 *   the token cannot ask for a million renders in one body — and a
 *   caller without it cannot ask for any;
 * - it can do nothing `revalidatePath` could not: a path the config
 *   does not cover is skipped, not rendered.
 *
 * It sits behind the app's rate limiter like any other route. */

export const REVALIDATE_ENDPOINT = '/__absolute/revalidate';

const MIN_TOKEN_LENGTH = 16;
const MAX_ITEMS = 100;
const HTTP_ACCEPTED = 202;
const HTTP_BAD_REQUEST = 400;
const HTTP_UNAUTHORIZED = 401;
const BEARER = /^Bearer\s+(.+)$/i;

type Asked = {
	all: boolean;
	background: boolean;
	paths: string[];
	tags: string[];
};

const isStringList = (value: unknown): value is string[] =>
	Array.isArray(value) && value.every((item) => typeof item === 'string');

const listOf = (value: unknown) => {
	if (value === undefined) return [];

	return isStringList(value) ? value : undefined;
};

/* The body as what was asked, or the reason it cannot be read as one. */
const readAsked = (body: unknown) => {
	if (typeof body !== 'object' || body === null || Array.isArray(body))
		return 'The body must be a JSON object with "paths", "tags" or "all".';
	const paths = listOf(Reflect.get(body, 'paths'));
	const tags = listOf(Reflect.get(body, 'tags'));
	if (!paths || !tags) return '"paths" and "tags" must be arrays of strings.';
	const all = Reflect.get(body, 'all') === true;
	if (paths.length + tags.length > MAX_ITEMS)
		return `One call may name at most ${MAX_ITEMS} paths and tags.`;
	if (!all && paths.length + tags.length === 0)
		return 'Nothing to revalidate: give "paths", "tags" or "all": true.';
	const asked: Asked = {
		all,
		background: Reflect.get(body, 'background') === true,
		paths,
		tags
	};

	return asked;
};

const presented = (request: Request) =>
	BEARER.exec(request.headers.get('authorization') ?? '')?.[1]?.trim();

const refuse = (status: number, error: string) =>
	Response.json(
		{ error },
		{
			headers:
				status === HTTP_UNAUTHORIZED
					? { 'www-authenticate': 'Bearer' }
					: {},
			status
		}
	);

/* A caller that does not wait: a CMS gives a webhook a few seconds, and
 * re-rendering a hundred pages can take longer. The work goes on after
 * the answer; a failure has nobody to report to, so it is logged. */
const startInBackground = (asked: Asked) => {
	void revalidateRequested(asked).then((result: RevalidateRequestResult) => {
		if (result.failed.length > 0)
			logWarn(
				`Revalidation requested through ${REVALIDATE_ENDPOINT} failed for ${result.failed.join(', ')}; those pages keep their previous copy.`
			);
	});

	return Response.json({ accepted: true }, { status: HTTP_ACCEPTED });
};

const usableToken = (token: string | undefined) => {
	if (token === undefined || token === '') return undefined;
	if (token.length >= MIN_TOKEN_LENGTH) return token;
	logWarn(
		`static.revalidateToken is shorter than ${MIN_TOKEN_LENGTH} characters, so ${REVALIDATE_ENDPOINT} is not enabled. Use a long random value.`
	);

	return undefined;
};

/** The revalidation endpoint, or an empty plugin when no usable token is
 *  configured — in which case the path is simply not a route. */
export const revalidateEndpoint = (configured: string | undefined) => {
	const plugin = new Elysia({ name: 'absolutejs-revalidate-endpoint' });
	const token = usableToken(configured);
	if (token === undefined) return plugin;

	return plugin.post(REVALIDATE_ENDPOINT, async ({ body, request }) => {
		const given = presented(request);
		if (given === undefined || !constantTimeEquals(given, token))
			return refuse(
				HTTP_UNAUTHORIZED,
				'A valid bearer token is required.'
			);
		const asked = readAsked(body);
		if (typeof asked === 'string') return refuse(HTTP_BAD_REQUEST, asked);
		if (asked.background) return startInBackground(asked);

		return Response.json(await revalidateRequested(asked));
	});
};
