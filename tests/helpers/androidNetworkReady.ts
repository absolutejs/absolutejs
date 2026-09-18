/** API 36 test-device readiness, not proof that the HTTPS backend is reachable. */
export const hasConnectedAndroidDefaultNetwork = (dump: string) => {
	const active = /^Active default network: (\d+)\s*$/mu.exec(dump)?.[1];
	if (!active) return false;
	const current = dump.split('Current Networks:')[1]?.split(/^\S/mu)[0];

	return (
		current
			?.split('\n')
			.some(
				(line) =>
					line.includes(`NetworkAgentInfo{network{${active}} `) &&
					/\bni\{[^}]*\bCONNECTED\b/u.test(line)
			) ?? false
	);
};
