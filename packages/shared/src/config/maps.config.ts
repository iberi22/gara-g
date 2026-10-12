/**
 * Google Maps Configuration
 * Phase 3B - Route Optimization
 */

declare const process: { env: { [key: string]: string | undefined } };

export const GOOGLE_MAPS_CONFIG = {
	apiKey: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || "",
	libraries: ["places", "geometry", "visualization"] as const,
	version: "weekly" as const,
	region: "ES",
	language: "es",
};

export const GOOGLE_APIS = {
	MAPS_JAVASCRIPT: "https://maps.googleapis.com/maps/api/js",
	ROUTES: "https://routes.googleapis.com/directions/v2:computeRoutes",
	PLACES: "https://places.googleapis.com/v1/places:searchText",
	GEOCODING: "https://maps.googleapis.com/maps/api/geocode/json",
	DISTANCE_MATRIX: "https://maps.googleapis.com/maps/api/distancematrix/json",
};

export const MAP_STYLES = {
	DEFAULT: [],
	DARK: [
		{ elementType: "geometry", stylers: [{ color: "#242f3e" }] },
		{ elementType: "labels.text.stroke", stylers: [{ color: "#242f3e" }] },
		{ elementType: "labels.text.fill", stylers: [{ color: "#746855" }] },
	],
	LIGHT: [
		{ elementType: "geometry", stylers: [{ color: "#f5f5f5" }] },
		{ elementType: "labels.text.fill", stylers: [{ color: "#616161" }] },
	],
};

export const DEFAULT_MAP_OPTIONS: {
	zoom: number;
	center: { lat: number; lng: number };
	mapTypeControl: boolean;
	streetViewControl: boolean;
	fullscreenControl: boolean;
	zoomControl: boolean;
} = {
	zoom: 12,
	center: { lat: 40.4168, lng: -3.7038 }, // Madrid, Spain
	mapTypeControl: true,
	streetViewControl: false,
	fullscreenControl: true,
	zoomControl: true,
};

export const ROUTE_COLORS = {
	planned: "#3B82F6", // blue
	active: "#10B981", // green
	completed: "#6B7280", // gray
	cancelled: "#EF4444", // red
	optimized: "#8B5CF6", // purple
};

export const VEHICLE_MARKER_COLORS = {
	idle: "#6B7280",
	moving: "#10B981",
	stopped: "#EF4444",
	offline: "#9CA3AF",
};
