import { mountRAGAPIShowcase } from '../../shared/ragApiShowcase';

const button = document.querySelector<HTMLButtonElement>('#counter-button');
const counter = document.querySelector<HTMLSpanElement>('#counter');
const details = document.querySelector<HTMLDetailsElement>('header details');
const ragShowcaseHost = document.querySelector<HTMLDivElement>(
	'[data-rag-api-showcase]'
);

if (button && counter) {
	let count = parseInt(counter.textContent || '0');

	button.addEventListener('click', () => {
		counter.textContent = (++count).toString();
	});
}

if (details) {
	details.addEventListener('pointerenter', () => {
		details.open = true;
	});

	details.addEventListener('pointerleave', () => {
		details.open = false;
	});
}

if (ragShowcaseHost) {
	mountRAGAPIShowcase(ragShowcaseHost);
}
