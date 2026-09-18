import { createAuthClient } from '@absolutejs/auth/client';
import {
	createSyncClient,
	getSyncClientRuntimeTransport,
	type SyncCollectionHandle
} from '@absolutejs/sync/client';
import { useEffect, useRef, useState } from 'react';
import type { AuthenticatedProofRow } from './authenticatedReleaseProofBackend';
import type { ReleaseProofProps } from './ReleaseDataProof';

/** Ordinary portable Auth/Sync APIs; no native APIs or synthetic transport. */
export const AuthenticatedReleaseProof = ({
	challenge,
	origin
}: ReleaseProofProps) => {
	const [account, setAccount] = useState('restoring');
	const [connection, setConnection] = useState('closed');
	const [pending, setPending] = useState(0);
	const [persisted, setPersisted] = useState(-1);
	const [rows, setRows] = useState<AuthenticatedProofRow[]>([]);
	const [failure, setFailure] = useState('');
	const collection =
		useRef<SyncCollectionHandle<AuthenticatedProofRow> | null>(null);
	const [revision, setRevision] = useState(0);
	useEffect(() => {
		let active = true;
		let statusRevision = 0;
		let dispose: (() => void) | undefined;
		const restore = async () => {
			const result = await createAuthClient().status();
			if (!active) return;
			const user = !result.error && result.data.user;
			const sub =
				user && typeof user === 'object'
					? Reflect.get(user, 'sub')
					: undefined;
			if (sub !== 'account-a' && sub !== 'account-b') {
				setAccount('signed-out');

				return;
			}
			setAccount(sub);
			const durable = getSyncClientRuntimeTransport()?.durable;
			if (!durable) throw new Error('Durable runtime unavailable');
			const sync = createSyncClient({
				maxReconnectMs: 1000,
				reconnectMs: 250,
				url: `${origin.replace('https:', 'wss:')}/sync/ws`,
				onError: () => {
					if (active) setFailure('Sync error');
				}
			});
			const handle = sync.collection<AuthenticatedProofRow>({
				collection: 'authenticated-proof'
			});
			collection.current = handle;
			const removeRows = handle.subscribe((state) => {
				if (active) setRows([...state.data]);
			});
			const removeStatus = sync.subscribeStatus((status) => {
				if (!active) return;
				const currentRevision = ++statusRevision;
				setConnection(status.connection);
				setPending(status.pending);
				void durable.store
					.transaction(durable.namespace, 'readonly', (transaction) =>
						transaction.listMutations()
					)
					.then((records) => {
						if (active && currentRevision === statusRevision)
							setPersisted(records.length);
					})
					.catch(() => {
						if (active) setFailure('Durable read failed');
					});
			});
			dispose = () => {
				removeRows();
				removeStatus();
				sync.close();
				collection.current = null;
			};
		};
		void restore().catch(() => {
			if (active) setFailure('Auth or durable startup failed');
		});

		return () => {
			active = false;
			dispose?.();
		};
	}, [origin, revision]);
	const signIn = async () => {
		setFailure('');
		const result = await createAuthClient().signIn.email({
			email: 'account-a@example.test',
			password: ''
		});
		if (result.error) {
			setFailure('Sign in failed');

			return;
		}
		setRevision((value) => value + 1);
	};
	const signOut = async () => {
		const result = await createAuthClient().signOut();
		if (result.error) {
			setFailure('Sign out failed');

			return;
		}
		setRows([]);
		setPending(0);
		setRevision((value) => value + 1);
	};
	const queue = () => {
		void collection.current
			?.mutate({ args: { challenge }, name: 'recordAuthenticatedProof' })
			.catch(() => setFailure('Mutation failed'));
	};

	return (
		<main>
			<h1>Authenticated release proof</h1>
			<p>Server proof {challenge}</p>
			<p>Account {account}</p>
			<p>Connection {connection}</p>
			<p>Pending {pending}</p>
			<p>Persisted {persisted}</p>
			<p>Committed {rows.length}</p>
			{rows.map((row) => (
				<p key={row.id}>
					Receipt {row.owner} {row.value}
				</p>
			))}
			<button onClick={() => void signIn()} type="button">
				Sign in
			</button>
			<button onClick={queue} type="button">
				Queue proof
			</button>
			<button onClick={() => void signOut()} type="button">
				Sign out
			</button>
			{failure && <p>{failure}</p>}
		</main>
	);
};
