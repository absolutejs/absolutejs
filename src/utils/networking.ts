import os from 'os';

/* Get all network IP addresses (IPv4 only)
   This handles the "detect all network interfaces" problem */
export const getAllNetworkIPs = (): string[] => {
	const interfaces = os.networkInterfaces();
	const addresses = Object.values(interfaces)
		.flat()
		.filter(
			(iface): iface is os.NetworkInterfaceInfo => iface !== undefined
		);
	
	// Only collect IPv4 addresses
	const ipv4Addresses: string[] = [];
	
	for (const addr of addresses) {
		// Skip loopback and internal addresses
		if (addr.internal) continue;
		
		// Only include IPv4 addresses
		if (addr.family === 'IPv4') {
			ipv4Addresses.push(addr.address);
		}
		// IPv6 addresses are excluded completely
	}
	
	return ipv4Addresses;
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
