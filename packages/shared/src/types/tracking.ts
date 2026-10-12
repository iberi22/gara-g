import type { GeographicLocation } from "./route";

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
