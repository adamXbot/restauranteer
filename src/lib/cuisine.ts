const CUISINE_LABEL: Record<string, string> = {
	italian_restaurant: 'Italian',
	french_restaurant: 'French',
	japanese_restaurant: 'Japanese',
	chinese_restaurant: 'Chinese',
	korean_restaurant: 'Korean',
	vietnamese_restaurant: 'Vietnamese',
	thai_restaurant: 'Thai',
	indian_restaurant: 'Indian',
	mexican_restaurant: 'Mexican',
	mediterranean_restaurant: 'Mediterranean',
	greek_restaurant: 'Greek',
	american_restaurant: 'American',
	steak_house: 'Steakhouse',
	seafood_restaurant: 'Seafood',
	sushi_restaurant: 'Sushi',
	ramen_restaurant: 'Ramen',
	pizza_restaurant: 'Pizza',
	hamburger_restaurant: 'Burgers',
	vegan_restaurant: 'Vegan',
	vegetarian_restaurant: 'Vegetarian',
	cafe: 'Café',
	bakery: 'Bakery',
	bar: 'Bar',
	wine_bar: 'Wine bar',
	pub: 'Pub',
	dessert_shop: 'Dessert',
	ice_cream_shop: 'Ice cream'
};

export function cuisinesFromTypes(types: string[]): string[] {
	const out = new Set<string>();
	for (const t of types) {
		const label = CUISINE_LABEL[t];
		if (label) out.add(label);
	}
	return [...out];
}
