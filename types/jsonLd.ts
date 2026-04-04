export type WithContext<T extends SchemaBase> = T & {
	'@context': 'https://schema.org';
};

export type SchemaBase = {
	'@type': string;
};

// --- Shared types ---

export type PostalAddress = {
	'@type': 'PostalAddress';
	streetAddress?: string;
	addressLocality?: string;
	addressRegion?: string;
	postalCode?: string;
	addressCountry?: string;
};

export type GeoCoordinates = {
	'@type': 'GeoCoordinates';
	latitude: number;
	longitude: number;
};

export type ContactPoint = {
	'@type': 'ContactPoint';
	telephone?: string;
	contactType?: string;
	availableLanguage?: string | string[];
};

export type Offer = {
	'@type': 'Offer';
	price?: string | number;
	priceCurrency?: string;
	availability?: string;
	url?: string;
	validFrom?: string;
};

export type AggregateRating = {
	'@type': 'AggregateRating';
	ratingValue: number | string;
	bestRating?: number | string;
	worstRating?: number | string;
	ratingCount?: number;
	reviewCount?: number;
};

export type Rating = {
	'@type': 'Rating';
	ratingValue: number | string;
	bestRating?: number | string;
};

export type NutritionInformation = {
	'@type': 'NutritionInformation';
	calories?: string;
	fatContent?: string;
	carbohydrateContent?: string;
	proteinContent?: string;
};

export type ImageObject = {
	'@type': 'ImageObject';
	url: string;
	width?: number;
	height?: number;
};

export type SearchAction = {
	'@type': 'SearchAction';
	target: string;
	'query-input': string;
};

// --- Person ---

export type PersonSchema = {
	'@type': 'Person';
	name: string;
	url?: string;
	image?: string;
	jobTitle?: string;
	sameAs?: string[];
	affiliation?: OrganizationSchema;
};

// --- Organization ---

export type OrganizationSchema = {
	'@type': 'Organization';
	name: string;
	url?: string;
	logo?: string | ImageObject;
	description?: string;
	foundingDate?: string;
	address?: PostalAddress;
	email?: string;
	telephone?: string;
	sameAs?: string[];
	contactPoint?: ContactPoint;
};

// --- WebSite ---

export type WebSiteSchema = {
	'@type': 'WebSite';
	name: string;
	url: string;
	logo?: string;
	potentialAction?: SearchAction;
};

// --- Article ---

export type ArticleSchema = {
	'@type': 'Article' | 'BlogPosting' | 'NewsArticle';
	headline: string;
	author?: PersonSchema | PersonSchema[];
	datePublished?: string;
	dateModified?: string;
	image?: string | string[];
	description?: string;
	articleBody?: string;
	publisher?: OrganizationSchema;
};

// --- Product ---

export type ProductSchema = {
	'@type': 'Product';
	name: string;
	image?: string | string[];
	description?: string;
	sku?: string;
	gtin?: string;
	brand?: OrganizationSchema | { '@type': 'Brand'; name: string };
	offers?: Offer | Offer[];
	aggregateRating?: AggregateRating;
	review?: ReviewSchema | ReviewSchema[];
};

// --- Review ---

export type ReviewSchema = {
	'@type': 'Review';
	author?: PersonSchema;
	datePublished?: string;
	name?: string;
	reviewBody?: string;
	reviewRating?: Rating;
	itemReviewed?: { '@type': string; name: string };
};

// --- BreadcrumbList ---

export type BreadcrumbItem = {
	'@type': 'ListItem';
	position: number;
	name: string;
	item?: string;
};

export type BreadcrumbListSchema = {
	'@type': 'BreadcrumbList';
	itemListElement: BreadcrumbItem[];
};

// --- FAQPage ---

export type FAQAnswer = {
	'@type': 'Answer';
	text: string;
};

export type FAQQuestion = {
	'@type': 'Question';
	name: string;
	acceptedAnswer: FAQAnswer;
};

export type FAQPageSchema = {
	'@type': 'FAQPage';
	mainEntity: FAQQuestion[];
};

// --- Event ---

export type EventSchema = {
	'@type': 'Event';
	name: string;
	startDate: string;
	endDate?: string;
	description?: string;
	image?: string;
	location?: {
		'@type': 'Place';
		name?: string;
		address?: PostalAddress;
	};
	organizer?: OrganizationSchema;
	offers?: Offer | Offer[];
};

// --- Recipe ---

export type HowToStep = {
	'@type': 'HowToStep';
	name?: string;
	text: string;
	image?: string;
};

export type RecipeSchema = {
	'@type': 'Recipe';
	name: string;
	image?: string | string[];
	author?: PersonSchema;
	description?: string;
	prepTime?: string;
	cookTime?: string;
	totalTime?: string;
	recipeCategory?: string;
	recipeCuisine?: string;
	recipeYield?: string;
	recipeIngredient?: string[];
	recipeInstructions?: (string | HowToStep)[];
	datePublished?: string;
	aggregateRating?: AggregateRating;
	nutrition?: NutritionInformation;
};

// --- VideoObject ---

export type VideoObjectSchema = {
	'@type': 'VideoObject';
	name: string;
	description: string;
	thumbnailUrl: string;
	embedUrl?: string;
	contentUrl?: string;
	duration?: string;
	uploadDate?: string;
	transcript?: string;
};

// --- HowTo ---

export type HowToSchema = {
	'@type': 'HowTo';
	name: string;
	description?: string;
	step: HowToStep[];
	image?: string;
	totalTime?: string;
	supply?: { '@type': 'HowToSupply'; name: string }[];
	tool?: { '@type': 'HowToTool'; name: string }[];
};

// --- LocalBusiness ---

export type LocalBusinessSchema = {
	'@type': 'LocalBusiness' | (string & {});
	name: string;
	address: PostalAddress;
	telephone?: string;
	image?: string;
	url?: string;
	priceRange?: string;
	geo?: GeoCoordinates;
	aggregateRating?: AggregateRating;
	openingHours?: string[];
	openingHoursSpecification?: {
		'@type': 'OpeningHoursSpecification';
		dayOfWeek: string | string[];
		opens: string;
		closes: string;
	}[];
};

// --- SoftwareApplication ---

export type SoftwareApplicationSchema = {
	'@type': 'SoftwareApplication';
	name: string;
	description?: string;
	image?: string;
	operatingSystem?: string;
	applicationCategory?: string;
	offers?: Offer;
	aggregateRating?: AggregateRating;
};

// --- JobPosting ---

export type JobPostingSchema = {
	'@type': 'JobPosting';
	title: string;
	description: string;
	hiringOrganization: OrganizationSchema;
	jobLocation?: { '@type': 'Place'; address: PostalAddress };
	employmentType?: string | string[];
	baseSalary?: {
		'@type': 'MonetaryAmount';
		currency: string;
		value:
			| number
			| { '@type': 'QuantitativeValue'; value: number; unitText: string };
	};
	datePosted?: string;
	validThrough?: string;
};

// --- Union of all schema types ---

export type JsonLdSchema =
	| ArticleSchema
	| BreadcrumbListSchema
	| EventSchema
	| FAQPageSchema
	| HowToSchema
	| JobPostingSchema
	| LocalBusinessSchema
	| OrganizationSchema
	| PersonSchema
	| ProductSchema
	| RecipeSchema
	| ReviewSchema
	| SoftwareApplicationSchema
	| VideoObjectSchema
	| WebSiteSchema;
