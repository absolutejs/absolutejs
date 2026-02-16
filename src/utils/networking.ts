import os from 'os';

type AddressEntry = {
	address: string;
	interfaceName: string;
};

/* Interface name helpers for prioritisation / exclusion */
const PREFERRED_INTERFACE_PATTERNS = [
	/^en\d+/i, // macOS Ethernet/Wi-Fi (en0, en1…)
	/^eth\d+/i, // Linux Ethernet (eth0…)
	/^wlan\d+/i, // Linux Wi-Fi (wlan0…)
	/^wl\d+/i, // Some Linux Wi-Fi adapters
	/^wi-?fi/i,
	/^lan\d*/i,
	/^ethernet/i,
	/^awdl/i // macOS AirDrop/Wi-Fi direct (acts as bridge for local devices)
];

const EXCLUDED_INTERFACE_PATTERNS = [
	/^utun/i, // macOS VPN interfaces
	/^ppp/i,
	/^tap/i,
	/^tun/i,
	/^ham/i,
	/^zt/i,
	/^zerotier/i,
	/^tailscale/i,
	/^docker/i,
	/^vbox/i,
	/^vmnet/i,
	/^bridge/i,
	/^br-/,
	/^llw/i,
	/^p2p/i
];

/* Link-local IPv4 addresses (169.254.x.x) are rarely useful for dev servers */
const LINK_LOCAL_PREFIX = '169.254.';

/* Get all network IP addresses (IPv4 only)
   Prioritise Wi-Fi/Ethernet adapters and de-prioritise VPN/tunnel interfaces */
export const getAllNetworkIPs = (): string[] => {
	const interfaces = os.networkInterfaces();

	const preferred: AddressEntry[] = [];
	const normal: AddressEntry[] = [];
	const fallback: AddressEntry[] = [];

	for (const [interfaceName, infos] of Object.entries(interfaces)) {
		if (!infos) continue;

		for (const info of infos) {
			if (!info || info.internal || info.family !== 'IPv4') continue;

			const address = info.address;
			const normalizedName = interfaceName.toLowerCase();

			if (address.startsWith(LINK_LOCAL_PREFIX)) {
				fallback.push({ address, interfaceName });
				continue;
			}

			if (
				EXCLUDED_INTERFACE_PATTERNS.some((pattern) =>
					pattern.test(normalizedName)
				)
			) {
				fallback.push({ address, interfaceName });
				continue;
			}

			const entry: AddressEntry = { address, interfaceName };
			if (
				PREFERRED_INTERFACE_PATTERNS.some((pattern) =>
					pattern.test(normalizedName)
				)
			) {
				preferred.push(entry);
			} else {
				normal.push(entry);
			}
		}
	}

	const ordered = [...preferred, ...normal];

	if (ordered.length === 0) {
		// Fall back to any remaining addresses (e.g., VPN/tunnels) if nothing else is available
		return dedupeAddresses(fallback);
	}

	return dedupeAddresses(ordered);
};

const dedupeAddresses = (entries: AddressEntry[]): string[] => {
	const seen = new Set<string>();
	const result: string[] = [];

	for (const { address } of entries) {
		if (seen.has(address)) continue;
		seen.add(address);
		result.push(address);
	}

	return result;
};

/* Get the first network IP address (for backward compatibility)
   This maintains compatibility with existing code that expects a single IP */
export const getLocalIPAddress = (): string => {
	const allIPs = getAllNetworkIPs();
	
	if (allIPs.length > 0 && allIPs[0]) {
		return allIPs[0]; // Return first IPv4 address
	}
	
	console.warn('No IP address found, falling back to localhost');
	return 'localhost'; // Fallback to localhost if no IP found
};
