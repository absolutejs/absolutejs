import { createElement } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { EslintStudio } from './page/EslintStudio';
import type { RuleCatalog } from '../../../../types/eslintStudio';

const isCatalogProps = (value: unknown): value is { catalog: RuleCatalog } =>
	typeof value === 'object' && value !== null && 'catalog' in value;

const initialProps = window.__INITIAL_PROPS__;

if (isCatalogProps(initialProps)) {
	hydrateRoot(
		document,
		createElement(EslintStudio, { catalog: initialProps.catalog })
	);
}
