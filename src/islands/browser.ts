export { defineIslandRegistry } from '../core/islands';
export { createIslandStore } from '../client/islandStore';

export const renderIslandMarkup = async () => {
	throw new Error(
		'renderIslandMarkup is server-only. Import from "@absolutejs/absolute/islands" on the server.'
	);
};
