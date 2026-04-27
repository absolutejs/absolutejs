import { withRegisteredStreamingSlots } from './responseEnhancers';

export const wrapPageHandlerWithStreamingSlots = <
	T extends (...args: unknown[]) => Response | Promise<Response>
>(
	handler: T,
	options?: Parameters<typeof withRegisteredStreamingSlots>[1]
) => {
	const wrapped = (...args: Parameters<T>) =>
		withRegisteredStreamingSlots(() => handler(...args), options);

	return wrapped;
};
