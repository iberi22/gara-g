import type { GeographicLocation } from "./basic";

export interface IoTDevice {
	id: string;
	name: string;
	type: "sensor" | "actuator" | "gateway" | "controller";
	vehicleId?: string;
	location?: GeographicLocation;
	status: "online" | "offline" | "error" | "maintenance";
	lastSeen: Date;
	firmware: string;
	battery?: number; // percentage
	sensors: IoTSensor[];
	configuration: Record<string, unknown>;
}

export interface IoTSensor {
	id: string;
	type: string; // e.g., 'temperature', 'pressure', 'accelerometer'
	unit: string;
	range: {
		min: number;
		max: number;
	};
	accuracy: number;
	sampleRate: number; // Hz
	enabled: boolean;
}

export interface SensorReading {
	deviceId: string;
	sensorId: string;
	timestamp: Date;
	value: number | string | boolean;
	unit: string;
	quality: "good" | "poor" | "error";
	location?: GeographicLocation;
}

export interface AnomalyDetection {
	id: string;
	type: "performance" | "behavior" | "security" | "maintenance";
	description: string;
	severity: "low" | "medium" | "high" | "critical";
	confidence: number; // 0-1
	timestamp: Date;
	vehicleId: string;
	sensorData: SensorReading[];
	resolved: boolean;
}

export interface TelematicsProfile {
	vehicleId: string;
	drivingBehavior: {
		aggressiveAcceleration: number;
		hardBraking: number;
		sharpTurns: number;
		speedingIncidents: number;
	};
	fuelEfficiency: number;
	maintenanceAlerts: TelematicsAlert[];
	diagnosticCodes: string[];
}

export interface TelematicsAlert {
	id: string;
	type: "maintenance" | "safety" | "performance" | "security";
	severity: "low" | "medium" | "high" | "critical";
	message: string;
	timestamp: Date;
	resolved: boolean;
	vehicleId: string;
}

export interface DataCollectionSettings {
	enabled: boolean;
	frequency: number; // seconds
	dataTypes: string[];
	privacy: {
		anonymize: boolean;
		retention: number; // days
		shareWithManufacturer: boolean;
	};
}
