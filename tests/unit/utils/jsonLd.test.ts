import { describe, expect, it } from 'bun:test';
import { jsonLd } from '../../../src/utils/jsonLd';
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
} from '../../../types/jsonLd';

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
			author: { '@type': 'Person', name: 'Chef Alex' },
			cookTime: 'PT30M',
			datePublished: '2026-03-28',
			description: 'A delicious test recipe',
			image: 'https://example.com/recipe.jpg',
			name: 'Test Recipe',
			nutrition: {
				'@type': 'NutritionInformation',
				calories: '250 calories'
			},
			prepTime: 'PT15M',
			recipeCategory: 'Dessert',
			recipeCuisine: 'American',
			recipeIngredient: ['2 cups flour', '1 cup sugar', '3 eggs'],
			recipeInstructions: [
				'Preheat oven',
				'Mix ingredients',
				'Bake for 30 minutes'
			],
			recipeYield: '8 servings',
			totalTime: 'PT45M'
		};
		const data = extractJson(jsonLd(schema));

		expect(data['@type']).toBe('Recipe');
		expect(data.recipeIngredient).toHaveLength(3);
		expect(data.recipeInstructions).toHaveLength(3);
		expect(data.nutrition['@type']).toBe('NutritionInformation');
	});

	it('VideoObject', () => {
		const schema: VideoObjectSchema = {
			'@type': 'VideoObject',
			contentUrl: 'https://example.com/video.mp4',
			description: 'A test video',
			duration: 'PT2M30S',
			embedUrl: 'https://example.com/embed/video',
			name: 'Test Video',
			thumbnailUrl: 'https://example.com/thumb.jpg',
			uploadDate: '2026-03-28T12:00:00Z'
		};
		const data = extractJson(jsonLd(schema));

		expect(data['@type']).toBe('VideoObject');
		expect(data.duration).toBe('PT2M30S');
		expect(data.thumbnailUrl).toBe('https://example.com/thumb.jpg');
	});

	it('HowTo', () => {
		const schema: HowToSchema = {
			'@type': 'HowTo',
			description: 'How to build an app',
			name: 'Build an App',
			step: [
				{
					'@type': 'HowToStep',
					name: 'Install dependencies',
					text: 'Run bun install'
				},
				{
					'@type': 'HowToStep',
					name: 'Start dev server',
					text: 'Run bun run dev'
				}
			],
			totalTime: 'PT10M'
		};
		const data = extractJson(jsonLd(schema));

		expect(data['@type']).toBe('HowTo');
		expect(data.step).toHaveLength(2);
		expect(data.step[0]['@type']).toBe('HowToStep');
	});

	it('LocalBusiness', () => {
		const schema: LocalBusinessSchema = {
			'@type': 'LocalBusiness',
			address: {
				'@type': 'PostalAddress',
				addressCountry: 'US',
				addressLocality: 'San Francisco',
				addressRegion: 'CA',
				postalCode: '94105',
				streetAddress: '123 Main St'
			},
			geo: {
				'@type': 'GeoCoordinates',
				latitude: 37.7749,
				longitude: -122.4194
			},
			name: 'AbsoluteJS Cafe',
			openingHours: ['Mo-Fr 09:00-17:00'],
			priceRange: '$$',
			telephone: '+1-555-123-4567',
			url: 'https://example.com'
		};
		const data = extractJson(jsonLd(schema));

		expect(data['@type']).toBe('LocalBusiness');
		expect(data.address['@type']).toBe('PostalAddress');
		expect(data.geo['@type']).toBe('GeoCoordinates');
	});

	it('SoftwareApplication', () => {
		const schema: SoftwareApplicationSchema = {
			'@type': 'SoftwareApplication',
			applicationCategory: 'DeveloperApplication',
			name: 'AbsoluteJS',
			offers: {
				'@type': 'Offer',
				price: '0',
				priceCurrency: 'USD'
			},
			operatingSystem: 'Windows, macOS, Linux'
		};
		const data = extractJson(jsonLd(schema));

		expect(data['@type']).toBe('SoftwareApplication');
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
			description: 'Build the future of TypeScript frameworks.',
			employmentType: 'FULL_TIME',
			hiringOrganization: {
				'@type': 'Organization',
				name: 'AbsoluteJS'
			},
			jobLocation: {
				'@type': 'Place',
				address: {
					'@type': 'PostalAddress',
					addressCountry: 'US',
					addressLocality: 'San Francisco',
					addressRegion: 'CA'
				}
			},
			title: 'Senior Framework Engineer',
			validThrough: '2026-04-30T23:59'
		};
		const data = extractJson(jsonLd(schema));

		expect(data['@type']).toBe('JobPosting');
		expect(data.hiringOrganization['@type']).toBe('Organization');
		expect(data.baseSalary['@type']).toBe('MonetaryAmount');
	});

	it('Person', () => {
		const schema: PersonSchema = {
			'@type': 'Person',
			jobTitle: 'Founder',
			name: 'Alex Kahn',
			sameAs: ['https://github.com/alexkahn'],
			url: 'https://alexkahn.dev'
		};
		const data = extractJson(jsonLd(schema));

		expect(data['@type']).toBe('Person');
		expect(data.name).toBe('Alex Kahn');
	});

	it('WebSite with search action', () => {
		const schema: WebSiteSchema = {
			'@type': 'WebSite',
			name: 'AbsoluteJS',
			potentialAction: {
				'@type': 'SearchAction',
				'query-input': 'required name=search_term_string',
				target: 'https://example.com/search?q={search_term_string}'
			},
			url: 'https://example.com'
		};
		const data = extractJson(jsonLd(schema));

		expect(data['@type']).toBe('WebSite');
		expect(data.potentialAction['@type']).toBe('SearchAction');
	});

	it('Review standalone', () => {
		const schema: ReviewSchema = {
			'@type': 'Review',
			author: { '@type': 'Person', name: 'Sam' },
			itemReviewed: { '@type': 'Product', name: 'AbsoluteJS Pro' },
			reviewBody: 'Excellent.',
			reviewRating: { '@type': 'Rating', ratingValue: 5 }
		};
		const data = extractJson(jsonLd(schema));

		expect(data['@type']).toBe('Review');
		expect(data.reviewRating['@type']).toBe('Rating');
	});

	it('Organization with full details', () => {
		const schema: OrganizationSchema = {
			'@type': 'Organization',
			address: {
				'@type': 'PostalAddress',
				addressCountry: 'US',
				addressLocality: 'San Francisco'
			},
			email: 'hello@example.com',
			foundingDate: '2026-01-01',
			logo: 'https://example.com/logo.png',
			name: 'AbsoluteJS',
			sameAs: ['https://github.com/absolutejs'],
			telephone: '+1-555-123-4567',
			url: 'https://example.com'
		};
		const data = extractJson(jsonLd(schema));

		expect(data['@type']).toBe('Organization');
		expect(data.logo).toBe('https://example.com/logo.png');
		expect(data.sameAs).toHaveLength(1);
	});

	it('multiple schemas on one page (Article + BreadcrumbList + Organization)', () => {
		const schemas: [
			ArticleSchema,
			BreadcrumbListSchema,
			OrganizationSchema
		] = [
			{ '@type': 'Article', headline: 'Test article' },
			{
				'@type': 'BreadcrumbList',
				itemListElement: [
					{ '@type': 'ListItem', name: 'Home', position: 1 }
				]
			},
			{ '@type': 'Organization', name: 'AbsoluteJS' }
		];
		const data = extractJson(jsonLd(schemas));

		expect(data).toHaveLength(3);
		expect(data[0]['@type']).toBe('Article');
		expect(data[1]['@type']).toBe('BreadcrumbList');
		expect(data[2]['@type']).toBe('Organization');
		expect(data[0]['@context']).toBe('https://schema.org');
		expect(data[1]['@context']).toBe('https://schema.org');
		expect(data[2]['@context']).toBe('https://schema.org');
	});

	it('produces valid JSON that can be parsed', () => {
		const schema: ProductSchema = {
			'@type': 'Product',
			name: 'Test Product'
		};
		const html = jsonLd(schema);
		const parsed = extractJson(html);

		expect(parsed.name).toBe('Test Product');
	});

	it('outputs valid script tag format', () => {
		const schema: PersonSchema = {
			'@type': 'Person',
			name: 'Test Person'
		};
		const html = jsonLd(schema);

		expect(html).toStartWith('<script type="application/ld+json">');
		expect(html).toEndWith('</script>');
	});
});
