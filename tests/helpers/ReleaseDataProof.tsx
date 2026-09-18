import { useEffect, useRef, useState } from 'react';
import { createSyncClient, type SyncClient } from '@absolutejs/sync/client';

export type ReleaseProofProps = { challenge: string; origin: string };
export type ReleaseProofRow = { id: string; value: string };

/** Synthetic acceptance UI, never imported by the framework runtime. */
export const ReleaseDataProof = ({ challenge, origin }: ReleaseProofProps) => {
	const client = useRef<SyncClient | null>(null);
	const [connection, setConnection] = useState('connecting');
	const [pending, setPending] = useState(0);
	const [rows, setRows] = useState<ReleaseProofRow[]>([]);
	const [error, setError] = useState('');
	useEffect(() => {
		const sync = createSyncClient({
			maxReconnectMs: 1000,
			reconnectMs: 250,
			url: `${origin.replace('https:', 'wss:')}/sync/ws`,
			onError: () => setError('Sync failed')
		});
		client.current = sync;
		const collection = sync.collection<ReleaseProofRow>({
			collection: 'proof'
		});
		const removeRows = collection.subscribe((state) =>
			setRows([...state.data])
		);
		const removeStatus = sync.subscribeStatus((status) => {
			setConnection(status.connection);
			setPending(status.pending);
		});

		return () => {
			removeRows();
			removeStatus();
			sync.close();
			client.current = null;
		};
	}, [origin]);
	const queue = () => {
		const collection = client.current?.collection<ReleaseProofRow>({
			collection: 'proof'
		});
		void collection
			?.mutate({ args: { challenge }, name: 'recordProof' })
			.catch(() => setError('Mutation failed'));
	};

	return (
		<section>
			<p>Server proof {challenge}</p>
			<p>Connection {connection}</p>
			<p>Pending {pending}</p>
			<p>Committed {rows.length}</p>
			{rows.map((row) => (
				<p key={row.id}>Receipt {row.value}</p>
			))}
			<button
				onClick={queue}
				style={{ fontSize: 24, padding: 24 }}
				type="button"
			>
				Queue proof
			</button>
			{error && <p>{error}</p>}
		</section>
	);
};
