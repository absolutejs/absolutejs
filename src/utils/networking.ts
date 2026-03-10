import os from 'os';

/* Get all network IP addresses (IPv4 only)
   This handles the "detect all network interfaces" problem */
export const getAllNetworkIPs = () => {
	const interfaces = os.networkInterfaces();
	const addresses = Object.values(interfaces)
		.flat()
		.filter(
			(iface): iface is os.NetworkInterfaceInfo => iface !== undefined
		);

	// Only collect IPv4 addresses
	const ipv4Addresses: string[] = [];

	addresses
		.filter((addr) => !addr.internal && addr.family === 'IPv4')
		.forEach((addr) => ipv4Addresses.push(addr.address));

	return ipv4Addresses;
};

/* Get the first network IP address (for backward compatibility)
   This maintains compatibility with existing code that expects a single IP */
export const getLocalIPAddress = () => {
	const allIPs = getAllNetworkIPs();

	if (allIPs.length > 0 && allIPs[0]) {
		return allIPs[0]; // Return first IPv4 address (or first available)
	}

	console.warn('No IP address found, falling back to localhost');

	return 'localhost'; // Fallback to localhost if no IP found
};
