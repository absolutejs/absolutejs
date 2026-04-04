export const hmrState: {
	isConnected: boolean;
	isFirstHMRUpdate: boolean;
	isHMRUpdating: boolean;
	pingInterval: ReturnType<typeof setInterval> | null;
	reconnectTimeout: ReturnType<typeof setTimeout> | null;
} = {
	isConnected: false,
	isFirstHMRUpdate: true,
	isHMRUpdating: false,
	pingInterval: null,
	reconnectTimeout: null
};
