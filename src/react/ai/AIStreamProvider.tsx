import {
	createContext,
	useContext,
	useEffect,
	useRef,
	type ReactNode
} from 'react';
import { createAIConnection } from '../../ai/client/connection';
import { createAIMessageStore } from '../../ai/client/messageStore';
import { serverMessageToAction } from '../../ai/client/actions';

type AIStreamContextValue = {
	connection: ReturnType<typeof createAIConnection>;
	store: ReturnType<typeof createAIMessageStore>;
};

const AIStreamContext = createContext<AIStreamContextValue | null>(null);

export const AIStreamProvider = ({
	children,
	path
}: {
	children: ReactNode;
	path: string;
}) => {
	const ref = useRef<AIStreamContextValue | null>(null);

	if (!ref.current) {
		const connection = createAIConnection(path);
		const store = createAIMessageStore();
		ref.current = { connection, store };
	}

	useEffect(() => {
		const { current } = ref;
		if (!current) {
			return undefined;
		}

		const { connection, store } = current;

		const unsubscribe = connection.subscribe((message) => {
			const action = serverMessageToAction(message);
			if (action) {
				store.dispatch(action);
			}
		});

		return () => {
			unsubscribe();
			connection.close();
		};
	}, []);

	return (
		<AIStreamContext.Provider value={ref.current}>
			{children}
		</AIStreamContext.Provider>
	);
};

export const useAIStreamContext = () => useContext(AIStreamContext);
