import './style.css';

export const packageAssetUrl = new URL('./package-asset.txt', import.meta.url);

export const readPackageAsset = async () => Bun.file(packageAssetUrl).text();

export const packageStyleMarker = 'PACKAGE_STYLE_SIDE_EFFECT_IMPORT_READY';
