// Shared lightweight types for cross-package usage

export interface VehicleHistory {
	date?: string; // ISO date string
	type?: string; // e.g., 'maintenance', 'repair', 'inspection'
	description?: string;
	cost?: number; // in default currency of the app
}

// Comprehensive vehicle history dataset used by db/functions responses
export interface VehicleHistoryData {
	vin: string;
	recalls: RecallRecord[];
	accidents: AccidentRecord[];
	ownership: OwnershipRecord[];
	serviceRecords: ServiceRecord[];
	specifications: VehicleSpecifications;
	marketValue: MarketValueInfo;
}

export interface RecallRecord {
	id: string;
	date: string; // ISO date string
	description: string;
	status: string; // e.g., 'Completado', 'Pendiente'
	severity: string; // e.g., 'Media', 'Alta'
}

export interface AccidentRecord {
	id: string;
	date: string; // ISO date string
	description: string;
	severity: string; // e.g., 'Leve', 'Moderada', 'Grave'
	repaired: boolean;
}

export interface OwnershipRecord {
	startDate: string; // ISO date string
	endDate: string | null; // null if current
	ownerType: string; // e.g., 'Individual', 'Empresa'
	state?: string; // region or state
}

export interface ServiceRecord {
	date: string; // ISO date string
	mileage: number;
	type: string; // e.g., 'Mantenimiento rutinario', 'Reparación'
	description: string;
	provider?: string;
	cost?: number; // optional if available
}

export interface VehicleSpecifications {
	make: string;
	model: string;
	year: number;
	engine?: string;
	transmission?: string;
	fuelType?: string;
	drivetrain?: string;
}

export interface MarketValueInfo {
	estimatedValue: number;
	currency: string; // e.g., 'USD', 'EUR'
	lastUpdated: string; // ISO date string
	source?: string; // e.g., 'KBB'
}
