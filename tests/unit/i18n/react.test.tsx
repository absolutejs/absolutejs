import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { Head } from '../../../src/react/components/Head';
import { I18nProvider, useI18n } from '../../../src/react/hooks/useI18n';
import { defineMessages } from '../../../src/i18n/defineMessages';
import type { I18nPayload } from '../../../types/i18n';

const english = defineMessages({
	cart: {
		count: '{count, plural, =0 {Your cart is empty} one {# item} other {# items}}',
		title: 'Cart for {name}'
	}
});

const payload: I18nPayload = {
	defaultLocale: 'en',
	dir: 'rtl',
	locale: 'ar',
	messages: {
		cart: {
			count: '{count, plural, zero {السلة فارغة} one {عنصر واحد} two {عنصران} few {# عناصر} many {# عنصرًا} other {# عنصر}}',
			title: 'سلة {name}'
		}
	}
};

const Cart = () => {
	const {
		dir,
		formatNumber,
		locale,
		t: translate
	} = useI18n<typeof english>();

	return (
		<section dir={dir} lang={locale}>
			<h1>{translate('cart.title', { name: 'Ada' })}</h1>
			<p>{translate('cart.count', { count: 4 })}</p>
			<span>{formatNumber(1234.5)}</span>
		</section>
	);
};

describe('React i18n', () => {
	test('useI18n translates with the provider payload', () => {
		const html = renderToStaticMarkup(
			<I18nProvider value={payload}>
				<Cart />
			</I18nProvider>
		);
		expect(html).toContain('<section dir="rtl" lang="ar">');
		expect(Object.keys(english.cart)).toEqual(['count', 'title']);
		expect(html).toContain('<h1>سلة Ada</h1>');
		expect(html).toContain('<p>4 عناصر</p>');
		expect(html).toContain(
			`<span>${new Intl.NumberFormat('ar').format(1234.5)}</span>`
		);
	});

	test('useI18n outside a provider throws a clear error', () => {
		expect(() => renderToStaticMarkup(<Cart />)).toThrow(/I18nProvider/);
	});

	test('Head renders hreflang alternates', () => {
		const html = renderToStaticMarkup(
			<Head
				alternates={[
					{ href: 'https://x.com/about', hreflang: 'en' },
					{ href: 'https://x.com/fr/about', hreflang: 'fr' },
					{ href: 'https://x.com/about', hreflang: 'x-default' }
				]}
			/>
		);
		expect(html).toContain(
			'<link href="https://x.com/fr/about" hrefLang="fr" rel="alternate"/>'
		);
		expect(html).toContain('hrefLang="x-default"');
	});
});
