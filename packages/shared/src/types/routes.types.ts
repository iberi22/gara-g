/**
 * Types for Route Optimization System
 * Phase 3B - Route Optimization
 */

export interface LatLng {
	lat: number;
	lng: number;
}

export interface Waypoint {
	id: string;
	location: LatLng;
	address?: string;
	name?: string;
	arrivalTime?: Date;
	departureTime?: Date;
	stopDuration?: number; // minutes
	priority?: "low" | "medium" | "high" | "critical";
	notes?: string;
}

export interface Route {
	id: string;
	organizationId: string;
	vehicleId: string;
	driverId?: string;
	name: string;
	waypoints: Waypoint[];
	status: "planned" | "active" | "completed" | "cancelled";
	startTime: Date;
	estimatedEndTime: Date;
	actualEndTime?: Date;
	totalDistance: number; // kilometers
	totalDuration: number; // minutes
	optimizationScore?: number;
	createdAt: Date;
	updatedAt: Date;
}

export interface OptimizationOptions {
	objective: "distance" | "time" | "fuel" | "balanced";
	considerTraffic: boolean;
	avoidTolls: boolean;
	avoidHighways: boolean;
	maxStopsPerRoute?: number;
	timeWindows?: boolean;
}

export interface OptimizedRoute {
	waypoints: Waypoint[];
	totalDistance: number;
	totalDuration: number;
	estimatedTime: number;
	fuelConsumption: number;
	optimizationScore: number;
	savings: {
		distance: number;
		time: number;
		fuel: number;
		cost: number;
	};
}

export interface VehicleLocation {
	vehicleId: string;
	location: LatLng;
	heading?: number; // degrees
	speed?: number; // km/h
	timestamp: Date;
	accuracy?: number; // meters
}

export interface Geofence {
	id: string;
	organizationId: string;
	name: string;
	type: "circular" | "polygon";
	center?: LatLng; // for circular
	radius?: number; // meters, for circular
	coordinates?: LatLng[]; // for polygon
	alertOnEntry: boolean;
	alertOnExit: boolean;
	active: boolean;
	createdAt: Date;
}

export interface GeofenceEvent {
	id: string;
	type: "entry" | "exit";
	vehicleId: string;
	geofenceId: string;
	location: LatLng;
	timestamp: Date;
	notified: boolean;
}

export interface RouteMetrics {
	routeId: string;
	actualDistance: number;
	actualDuration: number;
	fuelUsed: number;
	averageSpeed: number;
	stopsCompleted: number;
	deviations: number;
	onTimePercentage: number;
	efficiencyScore: number;
}
