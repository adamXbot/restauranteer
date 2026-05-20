import { json } from '@sveltejs/kit';

export const GET = () => {
	return json({
		status: 'ok',
		service: 'restauranteer',
		time: new Date().toISOString()
	});
};
