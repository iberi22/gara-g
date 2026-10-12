import type { PerformanceMetrics } from "./basic";
import type { MaintenanceRecord } from "./blockchain";
import type { AnomalyDetection, SensorReading } from "./iot";

export interface DigitalTwin {
	id: string;
	vehicleId: string;
	name: string;
	description?: string;
	version: string;
	status: "active" | "inactive" | "syncing" | "error";
	lastSync: Date;
	syncStatus: SyncStatus;
	model: ThreeDModel;
	data: TwinData;
	analytics: TwinAnalytics;
	interactions: TwinInteraction[];
	visualizationSettings: VisualizationSettings;
}

export interface TwinData {
	realTimeMetrics: Record<string, number>;
	historicalData: Record<string, number[]>;
	sensorReadings: SensorReading[];
	maintenanceRecords: MaintenanceRecord[];
	performanceMetrics: PerformanceMetrics;
	environmentalData: Record<string, unknown>;
}

export interface SimulationScenario {
	id: string;
	name: string;
	description: string;
	type: "stress_test" | "performance" | "maintenance" | "failure_analysis";
	parameters: Record<string, unknown>;
	duration: number; // seconds
	expectedResults: Record<string, unknown>;
}

export interface TwinAnalytics {
	usage: {
		totalInteractions: number;
		averageSessionTime: number;
		popularFeatures: string[];
	};
	performance: {
		renderTime: number;
		loadTime: number;
		memoryUsage: number;
	};
	insights: {
		predictedMaintenance: Date[];
		anomalies: AnomalyDetection[];
		recommendations: string[];
	};
}

export interface TwinInteraction {
	id: string;
	type: "view" | "inspect" | "simulate" | "modify";
	userId: string;
	timestamp: Date;
	duration: number; // seconds
	details: Record<string, unknown>;
}

export interface ThreeDModel {
	id: string;
	format: "gltf" | "fbx" | "obj" | "usd";
	url: string;
	size: number; // bytes
	vertices: number;
	polygons: number;
	textures: string[];
	animations: string[];
	boundingBox: {
		min: [number, number, number];
		max: [number, number, number];
	};
}

export interface PhysicsModel {
	id: string;
	type: "rigid_body" | "soft_body" | "fluid" | "particle";
	properties: {
		mass: number;
		density: number;
		friction: number;
		restitution: number;
		damping: number;
	};
	constraints: Record<string, unknown>;
	forces: Record<string, unknown>;
}

export interface SimulationEngine {
	id: string;
	name: string;
	version: string;
	type: "physics" | "thermal" | "fluid" | "structural" | "electrical";
	status: "ready" | "running" | "paused" | "error";
	capabilities: string[];
	parameters: Record<string, unknown>;
}

export interface SimulationResults {
	scenarioId: string;
	startTime: Date;
	endTime: Date;
	status: "completed" | "failed" | "cancelled";
	results: Record<string, unknown>;
	metrics: {
		accuracy: number;
		performance: number;
		reliability: number;
	};
	visualizations: string[]; // URLs to result visualizations
}

export interface SyncStatus {
	isOnline: boolean;
	lastSyncTime: Date;
	syncProgress: number; // 0-100
	pendingUpdates: number;
	errors: string[];
}

export interface VisualizationSettings {
	renderQuality: "low" | "medium" | "high" | "ultra";
	showSensors: boolean;
	showMetrics: boolean;
	showHistory: boolean;
	colorScheme: "default" | "performance" | "maintenance" | "custom";
	customColors?: Record<string, string>;
}
