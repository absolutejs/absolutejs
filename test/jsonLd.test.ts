/* eslint-disable no-magic-numbers */
import { describe, expect, it } from 'bun:test';
import { jsonLd } from '../src/utils/jsonLd';
import type {
	ArticleSchema,
	BreadcrumbListSchema,
	EventSchema,
	FAQPageSchema,
	HowToSchema,
	JobPostingSchema,
	LocalBusinessSchema,
	OrganizationSchema,
	PersonSchema,
	ProductSchema,
	RecipeSchema,
	ReviewSchema,
	SoftwareApplicationSchema,
	VideoObjectSchema,
	WebSiteSchema
} from '../types/jsonLd';

const extractJson = (html: string) => {
	const match = html.match(
		/<script type="application\/ld\+json">([\s\S]*?)<\/script>/
	);
	if (!match) throw new Error('No JSON-LD script tag found');

	if (!match[1]) throw new Error('No JSON-LD content found');

	return JSON.parse(match[1]);
};

describe('jsonLd', () => {
	it('wraps with @context', () => {
		const schema: ArticleSchema = {
			'@type': 'Article',
			headline: 'Test'
		};
		const data = extractJson(jsonLd(schema));

		expect(data['@context']).toBe('https://schema.org');
		expect(data['@type']).toBe('Article');
	});

	it('handles array of schemas', () => {
		const schemas: [WebSiteSchema, OrganizationSchema] = [
			{ '@type': 'WebSite', name: 'My Site', url: 'https://example.com' },
			{ '@type': 'Organization', name: 'My Org' }
		];
		const data = extractJson(jsonLd(schemas));

		expect(Array.isArray(data)).toBe(true);
		expect(data).toHaveLength(2);
		expect(data[0]['@context']).toBe('https://schema.org');
		expect(data[0]['@type']).toBe('WebSite');
		expect(data[1]['@context']).toBe('https://schema.org');
		expect(data[1]['@type']).toBe('Organization');
	});

	it('Article with full properties', () => {
		const schema: ArticleSchema = {
			'@type': 'Article',
			author: {
				'@type': 'Person',
				name: 'Alex Kahn',
				url: 'https://alexkahn.dev'
			},
			dateModified: '2026-03-28T12:00:00Z',
			datePublished: '2026-03-28T00:00:00Z',
			description: 'A guide to building web frameworks',
			headline: 'How to Build a Framework',
			image: [
				'https://example.com/image-1x1.jpg',
				'https://example.com/image-4x3.jpg',
				'https://example.com/image-16x9.jpg'
			],
			publisher: {
				'@type': 'Organization',
				logo: 'https://example.com/logo.png',
				name: 'AbsoluteJS'
			}
		};
		const data = extractJson(jsonLd(schema));

		expect(data['@type']).toBe('Article');
		expect(data.headline).toBe('How to Build a Framework');
		expect(data.author['@type']).toBe('Person');
		expect(data.author.name).toBe('Alex Kahn');
		expect(data.image).toHaveLength(3);
		expect(data.publisher['@type']).toBe('Organization');
		expect(data.publisher.logo).toBe('https://example.com/logo.png');
	});

	it('BlogPosting subtype', () => {
		const schema: ArticleSchema = {
			'@type': 'BlogPosting',
			datePublished: '2026-03-28',
			headline: 'My Blog Post'
		};
		const data = extractJson(jsonLd(schema));

		expect(data['@type']).toBe('BlogPosting');
	});

	it('Product with offers and rating', () => {
		const schema: ProductSchema = {
			'@type': 'Product',
			aggregateRating: {
				'@type': 'AggregateRating',
				bestRating: 5,
				ratingValue: 4.8,
				reviewCount: 142
			},
			brand: { '@type': 'Brand', name: 'AbsoluteJS' },
			description: 'The ultimate framework',
			image: 'https://example.com/product.jpg',
			name: 'AbsoluteJS Pro',
			offers: {
				'@type': 'Offer',
				availability: 'https://schema.org/InStock',
				price: '99.99',
				priceCurrency: 'USD',
				url: 'https://example.com/buy'
			},
			review: {
				'@type': 'Review',
				author: { '@type': 'Person', name: 'Jane' },
				reviewBody: 'Best framework ever',
				reviewRating: { '@type': 'Rating', ratingValue: 5 }
			},
			sku: 'AJS-PRO-001'
		};
		const data = extractJson(jsonLd(schema));

		expect(data['@type']).toBe('Product');
		expect(data.offers['@type']).toBe('Offer');
		expect(data.offers.price).toBe('99.99');
		expect(data.aggregateRating.ratingValue).toBe(4.8);
		expect(data.review['@type']).toBe('Review');
		expect(data.brand['@type']).toBe('Brand');
	});

	it('Product with multiple offers', () => {
		const schema: ProductSchema = {
			'@type': 'Product',
			name: 'Widget',
			offers: [
				{ '@type': 'Offer', price: '10', priceCurrency: 'USD' },
				{ '@type': 'Offer', price: '8.50', priceCurrency: 'EUR' }
			]
		};
		const data = extractJson(jsonLd(schema));

		expect(data.offers).toHaveLength(2);
		expect(data.offers[0].priceCurrency).toBe('USD');
		expect(data.offers[1].priceCurrency).toBe('EUR');
	});

	it('BreadcrumbList', () => {
		const schema: BreadcrumbListSchema = {
			'@type': 'BreadcrumbList',
			itemListElement: [
				{
					'@type': 'ListItem',
					item: 'https://example.com/',
					name: 'Home',
					position: 1
				},
				{
					'@type': 'ListItem',
					item: 'https://example.com/blog',
					name: 'Blog',
					position: 2
				},
				{ '@type': 'ListItem', name: 'My Post', position: 3 }
			]
		};
		const data = extractJson(jsonLd(schema));

		expect(data['@type']).toBe('BreadcrumbList');
		expect(data.itemListElement).toHaveLength(3);
		expect(data.itemListElement[0].position).toBe(1);
		expect(data.itemListElement[2].item).toBeUndefined();
	});

	it('FAQPage', () => {
		const schema: FAQPageSchema = {
			'@type': 'FAQPage',
			mainEntity: [
				{
					'@type': 'Question',
					acceptedAnswer: {
						'@type': 'Answer',
						text: 'A full-stack meta-framework for TypeScript.'
					},
					name: 'What is AbsoluteJS?'
				},
				{
					'@type': 'Question',
					acceptedAnswer: {
						'@type': 'Answer',
						text: 'React, Svelte, Vue, Angular, HTML, and HTMX.'
					},
					name: 'Which frameworks does it support?'
				}
			]
		};
		const data = extractJson(jsonLd(schema));

		expect(data['@type']).toBe('FAQPage');
		expect(data.mainEntity).toHaveLength(2);
		expect(data.mainEntity[0]['@type']).toBe('Question');
		expect(data.mainEntity[0].acceptedAnswer['@type']).toBe('Answer');
		expect(data.mainEntity[1].acceptedAnswer.text).toContain('React');
	});

	it('Event', () => {
		const schema: EventSchema = {
			'@type': 'Event',
			description: 'The first AbsoluteJS conference',
			endDate: '2026-09-16T17:00:00-07:00',
			location: {
				'@type': 'Place',
				address: {
					'@type': 'PostalAddress',
					addressCountry: 'US',
					addressLocality: 'San Francisco',
					addressRegion: 'CA',
					postalCode: '94105',
					streetAddress: '123 Main St'
				},
				name: 'Convention Center'
			},
			name: 'AbsoluteJS Conf 2026',
			offers: {
				'@type': 'Offer',
				availability: 'https://schema.org/InStock',
				price: '299',
				priceCurrency: 'USD',
				url: 'https://example.com/tickets'
			},
			organizer: { '@type': 'Organization', name: 'AbsoluteJS Team' },
			startDate: '2026-09-15T09:00:00-07:00'
		};
		const data = extractJson(jsonLd(schema));

		expect(data['@type']).toBe('Event');
		expect(data.startDate).toBe('2026-09-15T09:00:00-07:00');
		expect(data.location['@type']).toBe('Place');
		expect(data.location.address['@type']).toBe('PostalAddress');
		expect(data.organizer['@type']).toBe('Organization');
	});

	it('Recipe', () => {
		const schema: RecipeSchema = {
			'@type': 'Recipe',
			aggregateRating: {
				'@type': 'AggregateRating',
				ratingCount: 312,
				ratingValue: 4.9
			},
			author: { '@type': 'Person', name: 'Chef Bob' },
			cookTime: 'PT12M',
			image: 'https://example.com/cookies.jpg',
			name: 'Chocolate Chip Cookies',
			nutrition: {
				'@type': 'NutritionInformation',
				calories: '210 calories'
			},
			prepTime: 'PT15M',
			recipeIngredient: [
				'2 cups flour',
				'1 cup sugar',
				'1 cup chocolate chips'
			],
			recipeInstructions: [
				{ '@type': 'HowToStep', text: 'Mix dry ingredients' },
				{ '@type': 'HowToStep', text: 'Add wet ingredients' },
				{ '@type': 'HowToStep', text: 'Bake at 350F for 12 minutes' }
			],
			recipeYield: '24 cookies',
			totalTime: 'PT27M'
		};
		const data = extractJson(jsonLd(schema));

		expect(data['@type']).toBe('Recipe');
		expect(data.prepTime).toBe('PT15M');
		expect(data.recipeIngredient).toHaveLength(3);
		expect(data.recipeInstructions).toHaveLength(3);
		expect(data.recipeInstructions[0]['@type']).toBe('HowToStep');
		expect(data.nutrition['@type']).toBe('NutritionInformation');
	});

	it('VideoObject', () => {
		const schema: VideoObjectSchema = {
			'@type': 'VideoObject',
			description: 'Learn AbsoluteJS in 10 minutes',
			duration: 'PT10M30S',
			embedUrl: 'https://youtube.com/embed/abc123',
			name: 'AbsoluteJS Tutorial',
			thumbnailUrl: 'https://example.com/thumb.jpg',
			uploadDate: '2026-03-28'
		};
		const data = extractJson(jsonLd(schema));

		expect(data['@type']).toBe('VideoObject');
		expect(data.duration).toBe('PT10M30S');
		expect(data.embedUrl).toBe('https://youtube.com/embed/abc123');
	});

	it('HowTo', () => {
		const schema: HowToSchema = {
			'@type': 'HowTo',
			name: 'How to Set Up AbsoluteJS',
			step: [
				{
					'@type': 'HowToStep',
					name: 'Install',
					text: 'Run bun add @absolutejs/absolute'
				},
				{
					'@type': 'HowToStep',
					name: 'Configure',
					text: 'Create absolute.config.ts'
				},
				{ '@type': 'HowToStep', name: 'Run', text: 'Run bun run dev' }
			],
			tool: [
				{ '@type': 'HowToTool', name: 'Bun' },
				{ '@type': 'HowToTool', name: 'TypeScript' }
			]
		};
		const data = extractJson(jsonLd(schema));

		expect(data['@type']).toBe('HowTo');
		expect(data.step).toHaveLength(3);
		expect(data.step[0]['@type']).toBe('HowToStep');
		expect(data.tool).toHaveLength(2);
	});

	it('LocalBusiness', () => {
		const schema: LocalBusinessSchema = {
			'@type': 'LocalBusiness',
			address: {
				'@type': 'PostalAddress',
				addressCountry: 'US',
				addressLocality: 'Portland',
				addressRegion: 'OR',
				postalCode: '97201',
				streetAddress: '456 Oak Ave'
			},
			geo: {
				'@type': 'GeoCoordinates',
				latitude: 45.5231,
				longitude: -122.6765
			},
			name: "Joe's Coffee Shop",
			openingHoursSpecification: [
				{
					'@type': 'OpeningHoursSpecification',
					closes: '18:00',
					dayOfWeek: [
						'Monday',
						'Tuesday',
						'Wednesday',
						'Thursday',
						'Friday'
					],
					opens: '06:00'
				},
				{
					'@type': 'OpeningHoursSpecification',
					closes: '15:00',
					dayOfWeek: ['Saturday', 'Sunday'],
					opens: '07:00'
				}
			],
			priceRange: '$$',
			telephone: '+1-503-555-0100'
		};
		const data = extractJson(jsonLd(schema));

		expect(data['@type']).toBe('LocalBusiness');
		expect(data.address['@type']).toBe('PostalAddress');
		expect(data.geo['@type']).toBe('GeoCoordinates');
		expect(data.geo.latitude).toBe(45.5231);
		expect(data.openingHoursSpecification).toHaveLength(2);
	});

	it('SoftwareApplication', () => {
		const schema: SoftwareApplicationSchema = {
			'@type': 'SoftwareApplication',
			aggregateRating: {
				'@type': 'AggregateRating',
				ratingCount: 500,
				ratingValue: 4.9
			},
			applicationCategory: 'DeveloperApplication',
			description: 'A full-stack meta-framework',
			name: 'AbsoluteJS',
			offers: {
				'@type': 'Offer',
				price: '0',
				priceCurrency: 'USD'
			},
			operatingSystem: 'WINDOWS, MAC, LINUX'
		};
		const data = extractJson(jsonLd(schema));

		expect(data['@type']).toBe('SoftwareApplication');
		expect(data.offers.price).toBe('0');
		expect(data.applicationCategory).toBe('DeveloperApplication');
	});

	it('JobPosting', () => {
		const schema: JobPostingSchema = {
			'@type': 'JobPosting',
			baseSalary: {
				'@type': 'MonetaryAmount',
				currency: 'USD',
				value: {
					'@type': 'QuantitativeValue',
					unitText: 'YEAR',
					value: 180000
				}
			},
			datePosted: '2026-03-28',
			description: 'Build the next generation of web frameworks',
			employmentType: 'FULL_TIME',
			hiringOrganization: {
				'@type': 'Organization',
				name: 'AbsoluteJS Inc',
				url: 'https://absolutejs.com'
			},
			jobLocation: {
				'@type': 'Place',
				address: {
					'@type': 'PostalAddress',
					addressCountry: 'US',
					addressLocality: 'Remote'
				}
			},
			title: 'Senior TypeScript Engineer',
			validThrough: '2026-06-28'
		};
		const data = extractJson(jsonLd(schema));

		expect(data['@type']).toBe('JobPosting');
		expect(data.hiringOrganization['@type']).toBe('Organization');
		expect(data.baseSalary['@type']).toBe('MonetaryAmount');
		expect(data.baseSalary.value['@type']).toBe('QuantitativeValue');
		expect(data.baseSalary.value.value).toBe(180000);
	});

	it('Person', () => {
		const schema: PersonSchema = {
			'@type': 'Person',
			image: 'https://example.com/alex.jpg',
			jobTitle: 'Software Engineer',
			name: 'Alex Kahn',
			sameAs: [
				'https://github.com/alexkahndev',
				'https://twitter.com/alexkahn'
			],
			url: 'https://alexkahn.dev'
		};
		const data = extractJson(jsonLd(schema));

		expect(data['@type']).toBe('Person');
		expect(data.sameAs).toHaveLength(2);
	});

	it('WebSite with search action', () => {
		const schema: WebSiteSchema = {
			'@type': 'WebSite',
			name: 'AbsoluteJS',
			potentialAction: {
				'@type': 'SearchAction',
				'query-input': 'required name=search_term_string',
				target: 'https://absolutejs.com/search?q={search_term_string}'
			},
			url: 'https://absolutejs.com'
		};
		const data = extractJson(jsonLd(schema));

		expect(data['@type']).toBe('WebSite');
		expect(data.potentialAction['@type']).toBe('SearchAction');
		expect(data.potentialAction['query-input']).toBe(
			'required name=search_term_string'
		);
	});

	it('Review standalone', () => {
		const schema: ReviewSchema = {
			'@type': 'Review',
			author: { '@type': 'Person', name: 'Bob' },
			datePublished: '2026-03-15',
			itemReviewed: {
				'@type': 'SoftwareApplication',
				name: 'AbsoluteJS'
			},
			name: 'Great product',
			reviewBody: 'I love this framework. 10/10 would recommend.',
			reviewRating: { '@type': 'Rating', bestRating: 5, ratingValue: 5 }
		};
		const data = extractJson(jsonLd(schema));

		expect(data['@type']).toBe('Review');
		expect(data.reviewRating['@type']).toBe('Rating');
		expect(data.itemReviewed['@type']).toBe('SoftwareApplication');
	});

	it('Organization with full details', () => {
		const schema: OrganizationSchema = {
			'@type': 'Organization',
			contactPoint: {
				'@type': 'ContactPoint',
				contactType: 'technical support',
				telephone: '+1-555-0123'
			},
			foundingDate: '2025-01-01',
			logo: {
				'@type': 'ImageObject',
				height: 512,
				url: 'https://absolutejs.com/logo.png',
				width: 512
			},
			name: 'AbsoluteJS',
			sameAs: [
				'https://github.com/absolutejs',
				'https://twitter.com/absolutejs'
			],
			url: 'https://absolutejs.com'
		};
		const data = extractJson(jsonLd(schema));

		expect(data['@type']).toBe('Organization');
		expect(data.logo['@type']).toBe('ImageObject');
		expect(data.logo.width).toBe(512);
		expect(data.contactPoint['@type']).toBe('ContactPoint');
	});

	it('multiple schemas on one page (Article + BreadcrumbList + Organization)', () => {
		const schemas: (
			| ArticleSchema
			| BreadcrumbListSchema
			| OrganizationSchema
		)[] = [
			{
				'@type': 'Article',
				datePublished: '2026-03-28',
				headline: 'My Post'
			},
			{
				'@type': 'BreadcrumbList',
				itemListElement: [
					{
						'@type': 'ListItem',
						item: '/',
						name: 'Home',
						position: 1
					},
					{
						'@type': 'ListItem',
						item: '/blog',
						name: 'Blog',
						position: 2
					},
					{
						'@type': 'ListItem',
						name: 'My Post',
						position: 3
					}
				]
			},
			{
				'@type': 'Organization',
				name: 'AbsoluteJS'
			}
		];
		const data = extractJson(jsonLd(schemas));

		expect(data).toHaveLength(3);
		expect(data[0]['@type']).toBe('Article');
		expect(data[1]['@type']).toBe('BreadcrumbList');
		expect(data[2]['@type']).toBe('Organization');

		// each has its own @context
		for (const item of data) {
			expect(item['@context']).toBe('https://schema.org');
		}
	});

	it('produces valid JSON that can be parsed', () => {
		const schema: ProductSchema = {
			'@type': 'Product',
			description: 'A product with tricky characters: \\ / \n \t',
			name: 'Widget with "quotes" & <special> chars'
		};
		const html = jsonLd(schema);
		const data = extractJson(html);

		expect(data.name).toBe('Widget with "quotes" & <special> chars');
	});

	it('outputs valid script tag format', () => {
		const schema: WebSiteSchema = {
			'@type': 'WebSite',
			name: 'Test',
			url: 'https://test.com'
		};
		const html = jsonLd(schema);

		expect(html).toStartWith('<script type="application/ld+json">');
		expect(html).toEndWith('</script>');

		// Verify the JSON between tags is valid
		const jsonStr = html
			.replace('<script type="application/ld+json">', '')
			.replace('</script>', '');

		expect(() => JSON.parse(jsonStr)).not.toThrow();
	});
});
