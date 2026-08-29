const ENTRY_COPY_OWNER_PATTERN =
	/^\.absolutejs-hmr-(\d+)-(?:bootstrap-)?\d+\.[^.]+$/;

export const absoluteServerEntryCopyOwnerPid = (name: string) => {
	const match = ENTRY_COPY_OWNER_PATTERN.exec(name);
	if (!match) return null;
	const pid = Number(match[1]);

	return Number.isSafeInteger(pid) && pid > 0 ? pid : null;
};

export const isProcessAlive = (pid: number) => {
	try {
		process.kill(pid, 0);

		return true;
	} catch (error) {
		// ESRCH is the only result that proves the owner no longer exists.
		// EPERM and unknown platform errors must preserve the file because the
		// process may still be alive but inaccessible to this user.
		return !(
			error instanceof Error &&
			'code' in error &&
			error.code === 'ESRCH'
		);
	}
};

export const isStaleAbsoluteServerEntryCopy = (
	name: string,
	currentPid = process.pid,
	ownerIsAlive: (pid: number) => boolean = isProcessAlive
) => {
	const ownerPid = absoluteServerEntryCopyOwnerPid(name);
	if (ownerPid === null) return false;

	// On cold startup, this process cannot own a live copy yet. Treating a
	// recycled PID as ours clears the prior process's leftover safely.
	return ownerPid === currentPid || !ownerIsAlive(ownerPid);
};
