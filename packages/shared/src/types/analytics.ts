export interface FleetMetrics {
	totalVehicles: number;
	activeVehicles: number;
	totalDrivers: number;
	activeDrivers: number;
	totalMileage: number;
	fuelConsumption: number;
	maintenanceCosts: number;
	operatingCosts: number;
	utilizationRate: number;
	safetyScore: number;
	efficiencyScore: number;
}

export interface VehicleAnalytics {
	vehicleId: string;
	period: {
		start: Date;
		end: Date;
	};
	metrics: VehicleMetrics;
	trends: VehicleTrends;
	predictions: VehiclePredictions;
}

export interface VehicleMetrics {
	mileage: number;
	fuelEfficiency: number;
	uptime: number;
	maintenanceCount: number;
	totalCosts: number;
	safetyIncidents: number;
}

export interface VehicleTrends {
	fuelConsumption: TrendData[];
	maintenanceCosts: TrendData[];
	utilization: TrendData[];
}

export interface TrendData {
	date: Date;
	value: number;
}

export interface VehiclePredictions {
	nextMaintenance: Date;
	estimatedMaintenanceCost: number;
	remainingLifeTime: number;
	riskLevel: "low" | "medium" | "high";
}
