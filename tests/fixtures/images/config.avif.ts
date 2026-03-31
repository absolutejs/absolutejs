import { defineConfig } from '../../../src/utils/defineConfig';

export const config = defineConfig({
	assetsDirectory: 'tests/fixtures/images/assets',
	images: {
		formats: ['avif']
	}
});
