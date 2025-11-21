import { Elysia } from 'elysia';
import { env } from 'bun';
import { DEFAULT_PORT } from '../constants';

export const networking = (app: Elysia) =>
	app.listen(
		{
			hostname: env.HOST ?? 'localhost',
			port: env.PORT ? Number(env.PORT) : DEFAULT_PORT
		},
		() => {
			const port = env.PORT ? Number(env.PORT) : DEFAULT_PORT;
			console.log(`➜  Local:   http://localhost:${port}/`);
		}
	);
