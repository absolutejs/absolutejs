import { BYTES_PER_KILOBYTE } from '../constants';

/** Human-readable RSS for the `ps` table; `-` for unknown/zero. */
export const formatBytes = (bytes: number | null) => {
	if (bytes === null || bytes <= 0) return '-';
	if (bytes < BYTES_PER_KILOBYTE) return `${bytes} B`;
	const kilobytes = bytes / BYTES_PER_KILOBYTE;
	if (kilobytes < BYTES_PER_KILOBYTE) return `${Math.round(kilobytes)} KB`;
	const megabytes = kilobytes / BYTES_PER_KILOBYTE;
	if (megabytes < BYTES_PER_KILOBYTE) return `${megabytes.toFixed(1)} MB`;

	return `${(megabytes / BYTES_PER_KILOBYTE).toFixed(1)} GB`;
};
