export interface GeographicLocation {
	latitude: number;
	longitude: number;
	altitude?: number;
	accuracy?: number; // meters
	placeName?: string;
	countryCode?: string; // ISO 3166-1 alpha-2
}

export interface RouteWaypoint {
	id: string;
	location: GeographicLocation;
	name?: string;
	description?: string;
	order: number;
	estimatedArrival?: Date;
	actualArrival?: Date;
}

export interface RouteSegment {
	id: string;
	startWaypoint: string;
	endWaypoint: string;
	distance: number; // meters
	duration: number; // seconds
	roadType: "highway" | "city" | "rural" | "unknown";
	trafficCondition: "light" | "moderate" | "heavy" | "unknown";
}

export interface RouteStats {
	totalDistance: number; // meters
	totalDuration: number; // seconds
	averageSpeed: number; // km/h
	fuelConsumption?: number; // liters
	co2Emissions?: number; // grams
	tollCosts?: number;
}
