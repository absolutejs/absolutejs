import { inject, PendingTasks } from '@angular/core';

export const withPendingTask = async <Value>(work: () => Promise<Value>) => {
	const removeTask = inject(PendingTasks).add();

	try {
		return await work();
	} finally {
		removeTask();
	}
};
