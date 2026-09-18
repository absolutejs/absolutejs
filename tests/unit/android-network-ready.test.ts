import { expect, test } from 'bun:test';
import { hasConnectedAndroidDefaultNetwork } from '../helpers/androidNetworkReady';

const network = (id: number, state: string) =>
	`  NetworkAgentInfo{network{${id}} handle{1} ni{WIFI ${state} extra: }}`;
test('requires the active default network to be currently connected', () => {
	expect(
		hasConnectedAndroidDefaultNetwork(
			`Active default network: 110\r\n\r\nCurrent Networks:\r\n${network(110, 'CONNECTED')}\r\n`
		)
	).toBe(true);
	expect(
		hasConnectedAndroidDefaultNetwork(
			`Active default network: none\nCurrent Networks:\n${network(110, 'CONNECTED')}\n`
		)
	).toBe(false);
	expect(
		hasConnectedAndroidDefaultNetwork(
			`Active default network: 110\nCurrent Networks:\n${network(111, 'CONNECTED')}\n`
		)
	).toBe(false);
	expect(
		hasConnectedAndroidDefaultNetwork(
			`Active default network: 110\nCurrent Networks:\n${network(110, 'DISCONNECTED')}\n`
		)
	).toBe(false);
});

test('historical connected events cannot satisfy readiness', () => {
	expect(
		hasConnectedAndroidDefaultNetwork(
			`Active default network: 110\nCurrent Networks:\n\nNetwork history:\n${network(110, 'CONNECTED')}\n`
		)
	).toBe(false);
});
