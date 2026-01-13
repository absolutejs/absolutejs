const button = document.querySelector<HTMLButtonElement>('#counter-button');
const counter = document.querySelector<HTMLSpanElement>('#counter');
const details = document.querySelector<HTMLDetailsElement>('header details');

if (!button || !counter || !details) {
	throw new Error('Required elements not found');
}

let count = 0;

button.addEventListener('click', () => {
	counter.textContent = (++count).toString();
});

details.addEventListener('pointerenter', () => {
	details.open = true;
});

details.addEventListener('pointerleave', () => {
	details.open = false;
});
