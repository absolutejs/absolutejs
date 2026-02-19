import { createContext, useContext, useSyncExternalStore } from 'react';
import { Breakpoint, Breakpoints } from '../../../types/mediaQuery';
import { UserAgentType } from '../../../types/userAgentTypes';

const UserAgentContext = createContext<UserAgentType | null>(null);

export const UserAgentProvider = UserAgentContext.Provider;

const useUserAgentType = (): UserAgentType => {
	const context = useContext(UserAgentContext);
	if (context === null) {
		throw new Error(
			'useMediaQuery must be used within a UserAgentProvider'
		);
	}

	return context;
};

const defaultBreakpoints: Breakpoints = {
	xs: 0,
	sm: 640,
	md: 768,
	lg: 1024,
	xl: 1280,
	'2xl': 1536
};

const userAgentInitialWidth: Record<UserAgentType, number> = {
	bot: 1024,
	car: 768,
	console: 1024,
	desktop: 1024,
	iot: 640,
	other: 768,
	phone: 375,
	tablet: 768,
	tv: 1280
};

const subscribers = new Set<() => void>();
let width = typeof window !== 'undefined' ? window.innerWidth : 0;
let isListening = false;

const ensureListener = () => {
	if (isListening || typeof window === 'undefined') return;
	isListening = true;

	let isTicking = false;
	const onResize = () => {
		if (isTicking) return;
		isTicking = true;
		requestAnimationFrame(() => {
			isTicking = false;
			width = window.innerWidth;
			subscribers.forEach((notify) => notify());
		});
	};

	window.addEventListener('resize', onResize, { passive: true });
};

const subscribe = (callback: () => void) => {
	ensureListener();
	subscribers.add(callback);
	return () => subscribers.delete(callback);
};

const getViewportWidth = () => width;

const computeBreakpoint = (widthValue: number, breakpoints: Breakpoints) => {
	if (widthValue < breakpoints.sm) return 'xs';
	if (widthValue < breakpoints.md) return 'sm';
	if (widthValue < breakpoints.lg) return 'md';
	if (widthValue < breakpoints.xl) return 'lg';
	if (widthValue < breakpoints['2xl']) return 'xl';
	return '2xl';
};

export const useMediaQuery = (
	customBreakpoints: Breakpoints = defaultBreakpoints
) => {
	const userAgentType = useUserAgentType();
	const getServerWidth = () => userAgentInitialWidth[userAgentType];

	const currentWidth = useSyncExternalStore(
		subscribe,
		getViewportWidth,
		getServerWidth
	);

	const breakpoint = computeBreakpoint(currentWidth, customBreakpoints);

	const isSizeOrGreater = (target: Breakpoint) =>
		customBreakpoints[breakpoint] >= customBreakpoints[target];

	const isSizeOrLess = (target: Breakpoint) =>
		customBreakpoints[breakpoint] <= customBreakpoints[target];

	return { breakpoint, isSizeOrGreater, isSizeOrLess };
};
