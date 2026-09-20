/** Only transforms a disposable test AVD's configuration. */
export const androidTestTransportConfig = (
	config: string,
	transport: string | undefined
) => {
	if (transport === undefined) return config;
	if (transport !== 'pipe' && transport !== 'asg')
		throw new Error('Android diagnostic transport must be pipe or asg');
	const property = /^[\t ]*hw\.gltransport[\t ]*=[^\r\n]*/gmu;
	const matches = [...config.matchAll(property)];
	if (matches.length > 1)
		throw new Error('Ambiguous Android diagnostic transport configuration');
	const setting = `hw.gltransport=${transport}`;
	if (matches.length === 1) return config.replace(property, setting);
	const newline = config.includes('\r\n') ? '\r\n' : '\n';
	return `${config}${config && !config.endsWith('\n') ? newline : ''}${setting}${newline}`;
};
