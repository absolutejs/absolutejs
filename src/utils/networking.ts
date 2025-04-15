import os from "os";

export const getLocalIPAddress = () => {
	const interfaces = os.networkInterfaces();
	const addresses = Object.values(interfaces)
		.flat()
		.filter(
			(iface): iface is os.NetworkInterfaceInfo => iface !== undefined
		);
	const ipAddress = addresses.find(
		(iface) => iface.family === "IPv4" && !iface.internal
	);

	if (ipAddress) return ipAddress.address; // Return the first non-internal IPv4 address

	console.warn("No IP address found, falling back to localhost");

	return "localhost"; // Fallback to localhost if no IP found
};
