import { Elysia } from 'elysia';
import { recordFixtureEvaluation } from './evaluationCounter';

// Module-scope side effect: the cheapest probe for "was this module evaluated".
recordFixtureEvaluation();

export const apiPlugin = (tag: string) =>
	new Elysia({ prefix: '/api' })
		.get('/hello', () => ({ hello: tag }))
		.get('/item/:id', ({ params }) => ({ id: params.id }))
		.post('/echo', ({ body, headers }) => ({
			echoed: body,
			seen: headers['x-probe'] ?? null
		}))
		.get('/stream', function* stream() {
			yield 'chunk-a';
			yield 'chunk-b';
		})
		.ws('/socket', {
			message: (socket, message) => socket.send(`pong:${message}`)
		});
