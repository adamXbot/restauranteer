export type SourceId = 'broadsheet' | 'goodfood' | 'agfg' | 'applemaps' | 'timeout';

export type SourceCity = {
	id: string; // url slug e.g. 'melbourne'
	label: string; // display e.g. 'Melbourne'
};

/** Lightweight item returned by a city/directory listing. */
export type SourceListing = {
	source: SourceId;
	url: string;
	title: string;
	excerpt: string | null;
	image_url: string | null;
	suburb: string | null;
};

/** Full extraction from a single article page. */
export type ExtractedRestaurant = {
	source: SourceId;
	url: string;
	title: string;
	name: string; // best-guess restaurant name
	excerpt: string | null;
	address: string | null;
	suburb: string | null;
	lat: number | null;
	lng: number | null;
	phone: string | null;
	website: string | null;
	cuisine: string[];
	image_url: string | null;
	published_at: string | null;
};

/**
 * An article or external link stored on a vault restaurant's frontmatter.
 * `source` is typically a `SourceId` for adapter-extracted articles, or a
 * generic source slug (e.g. 'timeout', 'instagram', 'reddit') for arbitrary
 * URLs added via the generic link extractor.
 */
export type ArticleRef = {
	source: string;
	url: string;
	title: string;
	excerpt: string | null;
	fetched_at: string;
};

/** Known suburb the source has content for — slug used in URLs, label for UI. */
export type SourceSuburb = {
	slug: string;
	label: string;
};

export type SourceAdapter = {
	id: SourceId;
	label: string;
	cities: SourceCity[];
	/** True when this adapter can list a publication's directory filtered by suburb. */
	suburbBrowsable: boolean;
	/**
	 * True when this adapter can list a publication's directory for a whole city
	 * without a suburb filter. Sources where the directory listing doesn't expose
	 * suburb metadata (e.g. Time Out) set this instead of `suburbBrowsable`.
	 */
	cityBrowsable: boolean;
	/** Does this URL look like one of our article URLs? */
	matchesUrl(url: string): boolean;
	/** Fetch a single article URL and extract restaurant data. */
	extract(url: string): Promise<ExtractedRestaurant>;
	/** Browse the publication's directory pages for a specific suburb of a city. */
	discoverBySuburb?(city: string, suburb: string): Promise<SourceListing[]>;
	/** Browse the publication's directory page for a whole city (no suburb filter). */
	discoverByCity?(city: string): Promise<SourceListing[]>;
	/**
	 * Discover suburbs the source actually has content for in this city. Used to
	 * power the suburb autocomplete. Implementations should be tolerant of
	 * scrape failures and return whatever they could find.
	 */
	listSuburbs?(city: string): Promise<SourceSuburb[]>;
};
