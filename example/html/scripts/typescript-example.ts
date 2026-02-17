const button = document.querySelector<HTMLButtonElement>('#counter-button');
const counter = document.querySelector<HTMLSpanElement>('#counter');
const details = document.querySelector<HTMLDetailsElement>('header details');

if (!button || !counter || !details) {
	throw new Error('Required elements not found');
}

// Use preserved state from HMR if available, otherwise start from 0
// window.__HMR_DOM_STATE__ is set by the HMR client before scripts run
const hmrState = (
	window as unknown as { __HMR_DOM_STATE__?: { count?: number } }
).__HMR_DOM_STATE__;
let count = hmrState?.count ?? 0;

button.addEventListener('click', () => {
	counter.textContent = (++count).toString();
});

details.addEventListener('pointerenter', () => {
	details.open = true;
});

details.addEventListener('pointerleave', () => {
	details.open = false;
});
