import type { GeographicLocation } from "./basic";
import type {
	RouteSegment,
	RouteStats,
	RouteWaypoint,
} from "./route";

export interface Route {
	id: string;
	name: string;
	description?: string;
	waypoints: RouteWaypoint[];
	segments: RouteSegment[];
	stats: RouteStats;
	createdAt: Date;
	updatedAt: Date;
}

export interface LiveTrackingSession {
	id: string;
	vehicleId: string;
	userId: string;
	startTime: Date;
	endTime?: Date;
	isActive: boolean;
}

export interface TrackingAlert {
	id: string;
	type: "speed" | "route_deviation" | "traffic" | "weather" | "maintenance";
	severity: "low" | "medium" | "high" | "critical";
	message: string;
	timestamp: Date;
	location: GeographicLocation;
	acknowledged: boolean;
}
