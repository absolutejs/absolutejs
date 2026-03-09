import { getDurationString } from './getDurationString';

const colors = {
	bold: '\x1b[1m',
	cyan: '\x1b[36m',
	dim: '\x1b[2m',
	green: '\x1b[32m',
	reset: '\x1b[0m'
} as const;

const MONTHS = [
	'Jan',
	'Feb',
	'Mar',
	'Apr',
	'May',
	'Jun',
	'Jul',
	'Aug',
	'Sep',
	'Oct',
	'Nov',
	'Dec'
] as const;

export const formatTimestamp = () => {
	const now = new Date();
	const month = MONTHS[now.getMonth()];
	const day = now.getDate().toString().padStart(2, '0');
	let hours = now.getHours();
	const minutes = now.getMinutes().toString().padStart(2, '0');
	const seconds = now.getSeconds().toString().padStart(2, '0');
	const ampm = hours >= 12 ? 'PM' : 'AM';
	hours = hours % 12 || 12;

	return `${month} ${day} ${hours}:${minutes}:${seconds} ${ampm}`;
};

export const startupBanner = (options: {
	version: string;
	duration: number;
	port: string | number;
	host: string;
	networkUrl?: string;
}) => {
	const { version, duration, port, host, networkUrl } = options;
	const name = `${colors.cyan}${colors.bold}ABSOLUTEJS${colors.reset}`;
	const ver = `${colors.dim}v${version}${colors.reset}`;
	const time = `${colors.dim}ready in${colors.reset} ${colors.bold}${getDurationString(duration)}${colors.reset}`;
	console.log('');
	console.log(`  ${name} ${ver}  ${time}`);
	console.log('');
	console.log(
		`  ${colors.green}➜${colors.reset}  ${colors.bold}Local:${colors.reset}   http://${host === '0.0.0.0' ? 'localhost' : host}:${port}/`
	);
	if (networkUrl) {
		console.log(
			`  ${colors.green}➜${colors.reset}  ${colors.bold}Network:${colors.reset} ${networkUrl}`
		);
	}
	console.log('');
};
