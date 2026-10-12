export interface GeographicLocation {
	latitude: number;
	longitude: number;
	altitude?: number;
	accuracy?: number;
	placeName?: string;
	countryCode?: string;
}
export interface VehicleHistory {
	date?: string;
	type?: string;
	description?: string;
	cost?: number;
}
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
	date: string;
	description: string;
	status: string;
	severity: string;
}
export interface AccidentRecord {
	id: string;
	date: string;
	description: string;
	severity: string;
	repaired: boolean;
}
export interface OwnershipRecord {
	startDate: string;
	endDate: string | null;
	ownerType: string;
	state?: string;
}
export interface ServiceRecord {
	date: string;
	mileage: number;
	type: string;
	description: string;
	provider?: string;
	cost?: number;
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
	currency: string;
	lastUpdated: string;
	source?: string;
}
//# sourceMappingURL=types.d.ts.map
