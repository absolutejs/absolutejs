// HMR State Preservation: Use a persistent global counter that survives script re-executions
// This allows the counter to maintain its value across HMR updates
declare global {
	interface Window {
		__HTML_COUNTER_STATE__?: number;
		__HTML_COUNTER_VALUE__?: number;
		__HTML_SCRIPT_INITIALIZED__?: boolean;
		__HTML_COUNTER_HANDLER__?: () => void;
		__HTML_DETAILS_ENTER__?: () => void;
		__HTML_DETAILS_LEAVE__?: () => void;
	}
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

// Always remove old handlers before reattaching to avoid duplicates after HMR
if (window.__HTML_COUNTER_HANDLER__) {
	button.removeEventListener('click', window.__HTML_COUNTER_HANDLER__);
}
if (window.__HTML_DETAILS_ENTER__) {
	details.removeEventListener('pointerenter', window.__HTML_DETAILS_ENTER__);
}
if (window.__HTML_DETAILS_LEAVE__) {
	details.removeEventListener('pointerleave', window.__HTML_DETAILS_LEAVE__);
}

if (window.__HTML_SCRIPT_INITIALIZED__) {
	console.log('♻️ Re-initializing HTML script after HMR');
	if (window.__HTML_COUNTER_VALUE__ !== undefined) {
		counter.textContent = window.__HTML_COUNTER_VALUE__.toString();
	}
}

window.__HTML_COUNTER_HANDLER__ = () => {
	window.__HTML_COUNTER_VALUE__ = (window.__HTML_COUNTER_VALUE__ || 0) + 1;
	counter.textContent = window.__HTML_COUNTER_VALUE__.toString();
};

window.__HTML_DETAILS_ENTER__ = () => {
	details.open = true;
};
window.__HTML_DETAILS_LEAVE__ = () => {
	details.open = false;
};

button.addEventListener('click', window.__HTML_COUNTER_HANDLER__);
details.addEventListener('pointerenter', window.__HTML_DETAILS_ENTER__);
details.addEventListener('pointerleave', window.__HTML_DETAILS_LEAVE__);

// Mark script as initialized
window.__HTML_SCRIPT_INITIALIZED__ = true;
console.log('✅ HTML script initialized with counter value:', window.__HTML_COUNTER_VALUE__);
