export type SessionStore<
	TSession extends { id: string; createdAt: number },
	TSummary extends { id: string; createdAt: number } = {
		id: string;
		createdAt: number;
	}
> = {
	get: (id: string) => Promise<TSession | undefined>;
	getOrCreate: (id: string) => Promise<TSession>;
	set: (id: string, value: TSession) => Promise<void>;
	list: () => Promise<TSummary[]>;
	remove: (id: string) => Promise<void>;
};
