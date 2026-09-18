import { Elysia } from 'elysia';
import { syncSocket } from '@absolutejs/sync';
import {
	createSyncEngine,
	defineCollection,
	defineMutation
} from '@absolutejs/sync/engine';
import type { ReleaseProofProps, ReleaseProofRow } from './ReleaseDataProof';

/** Bound by the harness to loopback. No production data, auth, or persistence. */
export const createReleaseProofBackend = (proof: ReleaseProofProps) => {
	const rows: ReleaseProofRow[] = [];
	let writes = 0;
	const engine = createSyncEngine();
	engine.register(
		defineCollection<ReleaseProofRow>({
			name: 'proof',
			hydrate: () => [...rows],
			match: () => true
		})
	);
	engine.registerWriter('proof', {
		delete: () => {
			throw new Error('Unsupported');
		},
		insert: () => {
			const row: ReleaseProofRow = {
				id: String(++writes),
				value: proof.challenge
			};
			rows.push(row);

			return row;
		},
		update: () => {
			throw new Error('Unsupported');
		}
	});
	engine.registerMutation(
		defineMutation<{ challenge: string }>({
			name: 'recordProof',
			handler: (args, _context, actions) => {
				if (args.challenge !== proof.challenge)
					throw new Error('Wrong proof');

				return actions.insert('proof', {});
			}
		})
	);

	return new Elysia()
		.use(syncSocket({ engine, resolveContext: () => ({}) }))
		.get('/__proof', () => ({ challenge: proof.challenge, rows, writes }));
};
