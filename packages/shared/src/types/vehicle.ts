import type {
	DashboardWidget,
	GeographicLocation,
	HealthAlert,
	HealthRecommendation,
	SystemHealthRecord,
} from "./basic";

export interface VehicleHealthRecord {
	id: string;
	vehicleId: string;
	userId?: string;
	timestamp: Date;
	overallHealth: number; // 0-100
	systems: SystemHealthRecord[];
	recommendations: HealthRecommendation[];
	alerts: HealthAlert[];
	createdAt?: Date;
	updatedAt?: Date;
}

export interface MaintenanceScheduleItem {
	id: string;
	type: string;
	description: string;
	intervalMiles?: number;
	intervalMonths?: number;
	lastPerformed?: Date;
	nextDue: Date;
	cost?: number;
}

export interface MaintenanceSchedule {
	id: string;
	vehicleId: string;
	items: MaintenanceScheduleItem[];
	nextService: Date;
	createdAt: Date;
	updatedAt: Date;
}

export interface DashboardSettings {
	theme: "light" | "dark" | "auto";
	units: "metric" | "imperial";
	language: string;
	notifications: {
		maintenance: boolean;
		alerts: boolean;
		performance: boolean;
	};
	privacy: {
		shareLocation: boolean;
		sharePerformance: boolean;
		shareMaintenanceData: boolean;
	};
}

export interface VehicleDashboard {
	id: string;
	vehicleId: string;
	userId: string;
	settings: DashboardSettings;
	widgets: DashboardWidget[];
	alerts: MaintenanceAlert[];
	diagnostics: VehicleDiagnostics;
	telemetry: VehicleTelemetry;
	createdAt: Date;
	updatedAt: Date;
}

export interface DiagnosticTroubleCode {
	code: string;
	description: string;
	severity: "informational" | "warning" | "error" | "critical";
	system: string;
	status: "active" | "pending" | "permanent" | "cleared";
	firstDetected: Date;
	lastDetected: Date;
}

export interface MaintenanceAlert {
	id: string;
	vehicleId: string;
	type: "oil_change" | "tire_rotation" | "brake_inspection" | "general_service";
	severity: "low" | "medium" | "high" | "critical";
	title: string;
	description: string;
	dueDate?: Date;
	dueMileage?: number;
	dismissed: boolean;
	createdAt: Date;
}

export interface VehicleDiagnostics {
	vehicleId: string;
	timestamp: Date;
	obd2Connected: boolean;
	troubleCodes: DiagnosticTroubleCode[];
	systemStatus: SystemStatus[];
	fuelSystem: FuelSystemStatus;
	emissions: EmissionsStatus;
}

export interface SystemStatus {
	system: string;
	status: "ok" | "warning" | "error";
	details?: string;
}

export interface FuelSystemStatus {
	status: "ok" | "lean" | "rich" | "error";
	shortTermTrim: number;
	longTermTrim: number;
}

export interface EmissionsStatus {
	readiness: boolean;
	monitorStatus: Record<string, "complete" | "incomplete" | "not_supported">;
}

export interface VehicleTelemetry {
	vehicleId: string;
	timestamp: Date;
	speed: number; // km/h
	rpm: number;
	fuelLevel: number; // percentage
	engineTemp: number; // celsius
	oilPressure: number; // psi
	batteryVoltage: number; // volts
	location?: GeographicLocation;
	odometer: number; // km
}

export interface Vehicle {
	id: string;
	vin: string;
	make: string;
	model: string;
	year: number;
	ownerId: string;
	nickname?: string;
	licensePlate?: string;
	odometer: number;
	fuelType: "gasoline" | "diesel" | "electric" | "hybrid";
	transmission: "automatic" | "manual";
	drivetrain: "fwd" | "rwd" | "awd" | "4wd";
	color?: string;
	imageUrl?: string;
	createdAt: Date;
	updatedAt: Date;
}

export interface VehicleCompatibility {
	make: string;
	model: string;
	year: number;
	engine?: string;
	trim?: string;
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
