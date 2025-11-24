// HMR State Preservation: Use a persistent global counter that survives script re-executions
// This allows the counter to maintain its value across HMR updates
declare global {
	interface Window {
		__HTML_COUNTER_STATE__?: number;
		__HTML_COUNTER_VALUE__?: number;
		__HTML_SCRIPT_INITIALIZED__?: boolean;
	}
}

// Prevent multiple initializations in the same page load
if (window.__HTML_SCRIPT_INITIALIZED__) {
	console.log('📦 Script already initialized, skipping re-initialization');
	// Exit early - event listeners are already attached
	// eslint-disable-next-line no-restricted-syntax
	throw new Error('Script already initialized');
}

const button = document.querySelector<HTMLButtonElement>('#counter-button');
const counter = document.querySelector<HTMLSpanElement>('#counter');
const details = document.querySelector<HTMLDetailsElement>('header details');

if (!button || !counter || !details) {
	throw new Error('Required elements not found');
}

// Initialize counter from persistent global or preserved state
if (typeof window !== 'undefined') {
	// First check if we have a persistent counter value (from previous script execution)
	if (window.__HTML_COUNTER_VALUE__ === undefined) {
		// If not, check if HMR preserved the state
		if (window.__HTML_COUNTER_STATE__ !== undefined) {
			window.__HTML_COUNTER_VALUE__ = window.__HTML_COUNTER_STATE__;
			console.log('📦 Initialized counter from HMR preserved state:', window.__HTML_COUNTER_VALUE__);
			// Clear the HMR preserved state after using it
			window.__HTML_COUNTER_STATE__ = undefined;
		} else {
			// No preserved state, start from 0
			window.__HTML_COUNTER_VALUE__ = 0;
		}
	} else {
		console.log('📦 Using existing persistent counter value:', window.__HTML_COUNTER_VALUE__);
	}
	
	// Update the display to match the current state
	counter.textContent = window.__HTML_COUNTER_VALUE__.toString();
}

button.addEventListener('click', () => {
	// Increment the persistent global counter
	window.__HTML_COUNTER_VALUE__ = (window.__HTML_COUNTER_VALUE__ || 0) + 1;
	counter.textContent = window.__HTML_COUNTER_VALUE__.toString();
});

details.addEventListener('pointerenter', () => {
	details.open = true;
});

details.addEventListener('pointerleave', () => {
	details.open = false;
});

// Mark script as initialized
window.__HTML_SCRIPT_INITIALIZED__ = true;
console.log('✅ HTML script initialized with counter value:', window.__HTML_COUNTER_VALUE__);
