import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: 'The image optimizer created its cache directory (`<build>/.cache/images` unless `images.cacheDirectory` is set) when the server started, so a production server that could not write its build directory crashed on boot with `EACCES` or `EROFS`, even if the app never optimized an image. That is the usual container setup: the build copied in as root and the server running as a non-root user, or a read-only root filesystem. The directory is now created on the first image written to the cache. When it cannot be written, images are still optimized and served, just not cached. A prepared build now starts from a read-only directory with an empty HOME and writes nothing outside TMPDIR.',
	kind: 'fixed',
	summary:
		'Production servers start when their build directory is read-only, such as in a container running as a non-root user'
};
