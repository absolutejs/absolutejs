import {
	createContext,
	createElement,
	useContext,
	useMemo,
	type ReactNode
} from 'react';
import type { I18nPayload, MessageCatalog } from '../../../types/i18n';
import { createTranslator } from '../../i18n/translator';

const I18nContext = createContext<I18nPayload | null>(null);

type I18nProviderProps = {
	/** The payload from the server (`i18n.payload()`), passed down as a
	 *  page prop so the browser hydrates with the same messages. */
	value: I18nPayload;
	children?: ReactNode;
};

/** Makes a locale's messages available to `useI18n()` below it. */
export const I18nProvider = ({ value, children }: I18nProviderProps) =>
	createElement(I18nContext.Provider, { value }, children);

/** The translator for the nearest `I18nProvider`. Pass your default
 *  catalog's type to type-check keys and ICU parameters:
 *  `const { t } = useI18n<typeof en>()`. */
export const useI18n = <Catalog = MessageCatalog>() => {
	const payload = useContext(I18nContext);
	if (payload === null) {
		throw new Error('useI18n must be used within an I18nProvider');
	}

	return useMemo(() => createTranslator<Catalog>(payload), [payload]);
};
