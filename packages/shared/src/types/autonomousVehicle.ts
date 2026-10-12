import type { GeographicLocation, PerformanceMetrics } from "../types/basic";

export interface V2XMessage {
	id: string;
	type: "safety" | "traffic" | "emergency" | "info";
	source: string;
	destination?: string;
	timestamp: Date;
	location: GeographicLocation;
	data: Record<string, unknown>;
	priority: "low" | "medium" | "high" | "critical";
	ttl?: number; // time to live in seconds
}

export interface AutonomousVehicle {
	id: string;
	vin: string;
	make: string;
	model: string;
	year: number;
	autonomyLevel: 0 | 1 | 2 | 3 | 4 | 5; // SAE levels
	systems: AutonomousSystem[];
	performance: AutonomousPerformance;
	safetyMetrics: SafetyMetrics;
	currentLocation?: GeographicLocation;
	status: "active" | "inactive" | "maintenance" | "error";
}

export interface AutonomousSystem {
	id: string;
	name: string;
	type: "perception" | "planning" | "control" | "communication";
	version: string;
	status: "operational" | "degraded" | "failed";
	confidence: number; // 0-1
	lastUpdate: Date;
}

export interface AutonomousPerformance {
	milesAutonomous: number;
	disengagements: number;
	averageSpeed: number;
	fuelEfficiency: number;
	safetyScore: number;
	lastUpdated: Date;
}

export interface SafetyMetrics {
	collisionAvoidance: number; // incidents avoided
	emergencyBraking: number; // times activated
	laneKeeping: number; // corrections made
	blindSpotWarnings: number;
	overallSafetyRating: number; // 0-100
}

export interface AutonomousPerformanceMetrics {
	id: string;
	vehicleId: string;
	metrics: PerformanceMetrics;
	timestamp: Date;
}
