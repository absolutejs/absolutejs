import { withRegisteredStreamingSlots } from './responseEnhancers';

export const wrapPageHandlerWithStreamingSlots = <
	T extends (...args: unknown[]) => Response | Promise<Response>
>(
	handler: T,
	options?: Parameters<typeof withRegisteredStreamingSlots>[1]
) =>
	((...args: Parameters<T>) =>
		withRegisteredStreamingSlots(() => handler(...args), options)) as T;
