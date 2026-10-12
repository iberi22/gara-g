/**
 * Google Routes API Service
 * Phase 3B - Route Optimization
 *
 * Integrates with Google Routes API for real-time traffic-aware routing.
 * Includes local caching to minimize API costs.
 */

import { GOOGLE_APIS } from "../config/maps.config";
import type { LatLng, Waypoint } from "../types/routes.types";

interface RouteLeg {
	distanceMeters: number;
	duration: string;
	staticDuration: string;
	polyline: { encodedPolyline: string };
	startLocation: { latLng: { latitude: number; longitude: number } };
	endLocation: { latLng: { latitude: number; longitude: number } };
	steps: Array<{
		distanceMeters: number;
		duration: string;
		staticDuration: string;
		startLocation: { latLng: { latitude: number; longitude: number } };
		endLocation: { latLng: { latitude: number; longitude: number } };
		navigationInstruction?: { instructions: string };
		polyline: { encodedPolyline: string };
	}>;
}

interface RoutesResponse {
	routes: Array<{
		legs: RouteLeg[];
		distanceMeters: number;
		duration: string;
		staticDuration: string;
		description?: string;
		polyline: { encodedPolyline: string };
	}>;
}

interface CacheEntry {
	key: string;
	response: CachedRoute;
	timestamp: number;
}

interface CachedRoute {
	waypoints: Array<{ lat: number; lng: number }>;
	totalDistanceMeters: number;
	totalDurationSeconds: number;
	totalDurationTrafficSeconds: number;
	polyline: string;
}

export interface TrafficRouteResult {
	orderedWaypoints: Waypoint[];
	totalDistanceKm: number;
	totalDurationNoTrafficSec: number;
	totalDurationWithTrafficSec: number;
	polyline: string;
	legs: Array<{
		from: string;
		to: string;
		distanceKm: number;
		durationSec: number;
		durationTrafficSec: number;
	}>;
}

export class GoogleRoutesService {
	private readonly cache: Map<string, CacheEntry>;
	private readonly cacheTTLMs: number;
	private readonly maxCacheSize: number;
	private readonly apiKey: string;

	constructor(apiKey: string, cacheTTLMinutes = 30, maxCacheEntries = 500) {
		this.apiKey = apiKey;
		this.cache = new Map();
		this.cacheTTLMs = cacheTTLMinutes * 60 * 1000;
		this.maxCacheSize = maxCacheEntries;
	}

	/**
	 * Compute routes between ordered waypoints using Google Routes API
	 * Returns traffic-aware routing with step-by-step directions
	 */
	async computeRoute(
		orderedWaypoints: Waypoint[],
		options?: {
			optimizeWaypointOrder?: boolean;
			travelMode?: "DRIVE" | "TWO_WHEELER" | "TRANSIT";
			routingPreference?: "TRAFFIC_AWARE" | "TRAFFIC_AWARE_OPTIMAL";
			units?: "METRIC" | "IMPERIAL";
		},
	): Promise<TrafficRouteResult> {
		if (orderedWaypoints.length < 2) {
			throw new Error("At least 2 waypoints required for routing");
		}

		const travelMode = options?.travelMode ?? "DRIVE";
		const routingPreference =
			options?.routingPreference ?? "TRAFFIC_AWARE_OPTIMAL";

		// Check cache first
		const cacheKey = this.buildCacheKey(
			orderedWaypoints,
			travelMode,
			routingPreference,
		);
		const cached = this.getFromCache(cacheKey);
		if (cached) {
			return this.convertCachedToResult(cached, orderedWaypoints);
		}

		// Build request payload
		const payload = this.buildRoutesPayload(
			orderedWaypoints,
			travelMode,
			routingPreference,
		);

		try {
			const response = await this.callRoutesApi(payload);

			if (!response.routes || response.routes.length === 0) {
				// Fallback to Haversine-based estimation
				return this.fallbackToHaversine(orderedWaypoints);
			}

			const route = response.routes[0];
			const result = this.parseRoutesResponse(route, orderedWaypoints);

			// Cache the result
			const waypointsForCache = orderedWaypoints.map((wp) => ({
				lat: wp.location.lat,
				lng: wp.location.lng,
			}));
			this.addToCache(cacheKey, {
				waypoints: waypointsForCache,
				totalDistanceMeters: route.distanceMeters,
				totalDurationSeconds: result.totalDurationNoTrafficSec,
				totalDurationTrafficSeconds: result.totalDurationWithTrafficSec,
				polyline: route.polyline?.encodedPolyline ?? "",
			});

			return result;
		} catch (error) {
			console.error("Google Routes API call failed:", error);
			return this.fallbackToHaversine(orderedWaypoints);
		}
	}

	/**
	 * Compute distance matrix with traffic data between all waypoints
	 */
	async computeDistanceMatrix(waypoints: Waypoint[]): Promise<
		Array<
			Array<{
				distanceKm: number;
				durationSec: number;
				durationTrafficSec: number;
			}>
		>
	> {
		const size = waypoints.length;
		const matrix: Array<
			Array<{
				distanceKm: number;
				durationSec: number;
				durationTrafficSec: number;
			}>
		> = Array.from({ length: size }, () => Array(size));

		const batchPromises = [];
		for (let i = 0; i < size; i++) {
			for (let j = 0; j < size; j++) {
				if (i === j) {
					matrix[i][j] = {
						distanceKm: 0,
						durationSec: 0,
						durationTrafficSec: 0,
					};
					continue;
				}

				const from = waypoints[i];
				const to = waypoints[j];

				const promise = this.computeRoute([from, to])
					.then((result) => {
						matrix[i][j] = {
							distanceKm: result.totalDistanceKm,
							durationSec: result.totalDurationNoTrafficSec,
							durationTrafficSec: result.totalDurationWithTrafficSec,
						};
					})
					.catch(() => {
						matrix[i][j] = {
							distanceKm: this.haversineDistance(from.location, to.location),
							durationSec: 0,
							durationTrafficSec: 0,
						};
					});

				batchPromises.push(promise);

				// Process in batches to avoid rate limits
				if (batchPromises.length >= 10) {
					await Promise.all(batchPromises);
					batchPromises.length = 0;
				}
			}
		}

		if (batchPromises.length > 0) {
			await Promise.all(batchPromises);
		}

		return matrix;
	}

	/**
	 * Clear the cache
	 */
	clearCache(): void {
		this.cache.clear();
	}

	/**
	 * Get cache statistics
	 */
	getCacheStats(): { size: number; keys: string[] } {
		return {
			size: this.cache.size,
			keys: Array.from(this.cache.keys()),
		};
	}

	/**
	 * Build the cache key from waypoints and options
	 */
	private buildCacheKey(
		waypoints: Waypoint[],
		travelMode: string,
		routingPreference: string,
	): string {
		const coords = waypoints
			.map(
				(wp) => `${wp.location.lat.toFixed(5)},${wp.location.lng.toFixed(5)}`,
			)
			.join("|");
		return `${coords}|${travelMode}|${routingPreference}`;
	}

	/**
	 * Get from cache if valid
	 */
	private getFromCache(key: string): CachedRoute | null {
		const entry = this.cache.get(key);
		if (!entry) return null;

		const age = Date.now() - entry.timestamp;
		if (age > this.cacheTTLMs) {
			this.cache.delete(key);
			return null;
		}

		return entry.response;
	}

	/**
	 * Add to cache with eviction if needed
	 */
	private addToCache(key: string, response: CachedRoute): void {
		// Evict oldest if cache is full
		if (this.cache.size >= this.maxCacheSize) {
			let oldestKey = "";
			let oldestTime = Date.now();
			for (const [k, v] of this.cache.entries()) {
				if (v.timestamp < oldestTime) {
					oldestTime = v.timestamp;
					oldestKey = k;
				}
			}
			if (oldestKey) this.cache.delete(oldestKey);
		}

		this.cache.set(key, {
			key,
			response,
			timestamp: Date.now(),
		});
	}

	/**
	 * Build the Routes API request payload
	 */
	private buildRoutesPayload(
		waypoints: Waypoint[],
		travelMode: string,
		routingPreference: string,
	): object {
		const waypointsPayload = waypoints.map((wp) => ({
			location: {
				latLng: {
					latitude: wp.location.lat,
					longitude: wp.location.lng,
				},
			},
		}));

		return {
			origin: waypointsPayload[0],
			destination: waypointsPayload[waypointsPayload.length - 1],
			intermediates: waypointsPayload.slice(1, -1),
			travelMode,
			routingPreference,
			computeAlternativeRoutes: false,
			languageCode: "es",
			units: "METRIC",
			polylineQuality: "HIGH_QUALITY",
			polylineEncoding: "ENCODED_POLYLINE",
		};
	}

	/**
	 * Make the HTTP call to Google Routes API
	 */
	private async callRoutesApi(payload: object): Promise<RoutesResponse> {
		if (!this.apiKey) {
			throw new Error("Google Maps API key is not configured");
		}

		const url = `${GOOGLE_APIS.ROUTES}?key=${this.apiKey}`;

		const response = await fetch(url, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"X-Goog-FieldMask":
					"routes.duration,routes.staticDuration,routes.distanceMeters,routes.polyline,routes.legs.distanceMeters,routes.legs.duration,routes.legs.staticDuration,routes.legs.polyline,routes.legs.steps,routes.legs.startLocation,routes.legs.endLocation",
			},
			body: JSON.stringify(payload),
		});

		if (!response.ok) {
			const errorBody = await response.text();
			throw new Error(
				`Google Routes API error ${response.status}: ${errorBody}`,
			);
		}

		return response.json() as Promise<RoutesResponse>;
	}

	/**
	 * Parse the Routes API response into our format
	 */
	private parseRoutesResponse(
		route: RoutesResponse["routes"][0],
		orderedWaypoints: Waypoint[],
	): TrafficRouteResult {
		const legs = route.legs.map((leg, i) => ({
			from: orderedWaypoints[i]?.name ?? orderedWaypoints[i]?.id ?? `wp${i}`,
			to:
				orderedWaypoints[i + 1]?.name ??
				orderedWaypoints[i + 1]?.id ??
				`wp${i + 1}`,
			distanceKm: leg.distanceMeters / 1000,
			durationSec: this.parseDuration(leg.staticDuration),
			durationTrafficSec: this.parseDuration(leg.duration),
		}));

		return {
			orderedWaypoints,
			totalDistanceKm: route.distanceMeters / 1000,
			totalDurationNoTrafficSec: this.parseDuration(route.staticDuration),
			totalDurationWithTrafficSec: this.parseDuration(route.duration),
			polyline: route.polyline?.encodedPolyline ?? "",
			legs,
		};
	}

	/**
	 * Parse ISO 8601 duration string to seconds
	 * e.g., "120s" -> 120, "1h30m" -> 5400
	 */
	private parseDuration(duration: string): number {
		if (!duration) return 0;
		const match = duration.match(/(\d+)s/);
		if (match) return Number.parseInt(match[1], 10);

		// Handle more complex formats
		let total = 0;
		const hours = duration.match(/(\d+)h/);
		const minutes = duration.match(/(\d+)m/);
		const seconds = duration.match(/(\d+)s/);

		if (hours) total += Number.parseInt(hours[1], 10) * 3600;
		if (minutes) total += Number.parseInt(minutes[1], 10) * 60;
		if (seconds) total += Number.parseInt(seconds[1], 10);

		return total;
	}

	/**
	 * Convert cached entry back to TrafficRouteResult
	 */
	private convertCachedToResult(
		cached: CachedRoute,
		originalWaypoints: Waypoint[],
	): TrafficRouteResult {
		// Estimate per-leg distances proportionally
		const totalKm = cached.totalDistanceMeters / 1000;
		const equalLeg = totalKm / Math.max(originalWaypoints.length - 1, 1);

		const legs = originalWaypoints.slice(0, -1).map((wp, i) => ({
			from: wp.name ?? wp.id ?? `wp${i}`,
			to:
				originalWaypoints[i + 1]?.name ??
				originalWaypoints[i + 1]?.id ??
				`wp${i + 1}`,
			distanceKm: equalLeg,
			durationSec:
				cached.totalDurationSeconds / Math.max(originalWaypoints.length - 1, 1),
			durationTrafficSec:
				cached.totalDurationTrafficSeconds /
				Math.max(originalWaypoints.length - 1, 1),
		}));

		return {
			orderedWaypoints: originalWaypoints,
			totalDistanceKm: totalKm,
			totalDurationNoTrafficSec: cached.totalDurationSeconds,
			totalDurationWithTrafficSec: cached.totalDurationTrafficSeconds,
			polyline: cached.polyline,
			legs,
		};
	}

	/**
	 * Fallback: estimate route using Haversine distance when API is unavailable
	 */
	private async fallbackToHaversine(
		orderedWaypoints: Waypoint[],
	): Promise<TrafficRouteResult> {
		const legs = [];
		let totalDistanceKm = 0;
		let totalDurationSec = 0;

		for (let i = 0; i < orderedWaypoints.length - 1; i++) {
			const from = orderedWaypoints[i];
			const to = orderedWaypoints[i + 1];

			// Haversine is straight-line; realistic road distance is ~1.3x
			const straightKm = this.haversineDistance(from.location, to.location);
			const roadKm = straightKm * 1.3;
			const durationSec = (roadKm / 50) * 3600; // 50 km/h average

			legs.push({
				from: from.name ?? from.id ?? `wp${i}`,
				to: to.name ?? to.id ?? `wp${i + 1}`,
				distanceKm: roadKm,
				durationSec,
				durationTrafficSec: durationSec * 1.15, // Traffic adds ~15%
			});
			totalDistanceKm += roadKm;
			totalDurationSec += durationSec;
		}

		return {
			orderedWaypoints,
			totalDistanceKm,
			totalDurationNoTrafficSec: totalDurationSec,
			totalDurationWithTrafficSec: totalDurationSec * 1.15,
			polyline: "",
			legs,
		};
	}

	/**
	 * Haversine distance between two points in km
	 */
	private haversineDistance(p1: LatLng, p2: LatLng): number {
		const R = 6371;
		const dLat = this.toRad(p2.lat - p1.lat);
		const dLng = this.toRad(p2.lng - p1.lng);
		const a =
			Math.sin(dLat / 2) ** 2 +
			Math.cos(this.toRad(p1.lat)) *
				Math.cos(this.toRad(p2.lat)) *
				Math.sin(dLng / 2) ** 2;
		return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
	}

	private toRad(deg: number): number {
		return deg * (Math.PI / 180);
	}
}
