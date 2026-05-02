const button = document.querySelector('#increment');
let count = 0;

button?.addEventListener('click', () => {
	count += 1;
	button.textContent = `Count ${count}`;
});

const dynamicFeature = document.querySelector('#dynamic-feature');
const workerFeature = document.querySelector('#worker-feature');

import('/browser-dynamic.js').then((module) => {
	if (dynamicFeature) {
		dynamicFeature.textContent = module.loadDynamicFeature();
	}
});

const worker = new Worker('/browser-worker.js', { type: 'module' });
worker.addEventListener('message', (event) => {
	if (workerFeature) {
		workerFeature.textContent = String(event.data);
	}
	worker.terminate();
});
worker.postMessage('compile');
