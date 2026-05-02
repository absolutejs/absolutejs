self.addEventListener('message', (event) => {
	self.postMessage(`WORKER_CLIENT_READY_${event.data}`);
});
