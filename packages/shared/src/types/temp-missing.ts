// Temporary file with missing types to make build pass
// TODO: Move these to proper files

// Only truly missing types that are not defined elsewhere
export interface ConsentRecord {
	id: string;
	userId: string;
	purpose: string;
	granted: boolean;
	timestamp: Date;
}

export interface IdentityVerification {
	id: string;
	identityId: string;
	verifier: string;
	status: string;
	verifiedAt?: Date;
}

export interface PerformanceMetrics {
	latency: {
		average: number;
		p50: number;
		p95: number;
		p99: number;
	};
	throughput: number;
	errorRate: number;
	uptime: number;
	costs: CostMetrics;
}

export interface CostMetrics {
	total: number;
	perConversation: number;
	perToken: number;
	byModel: ModelCost[];
}

export interface ModelCost {
	model: string;
	cost: number;
	tokens: number;
	conversations: number;
}

export interface UserPreferences {
	id: string;
	userId: string;
	preferences: Record<string, unknown>;
	updatedAt: Date;
}

export interface SocialActivity {
	id: string;
	userId: string;
	type: string;
	content: string;
	timestamp: Date;
	likes: number | string[];
	comments: number | string[];
	title?: string;
	description?: string;
	createdAt?: Date;
	metadata?: Record<string, unknown>;
}

export interface Vehicle {
	id: string;
	userId: string;
	make: string;
	model: string;
	year: number;
	vin?: string;
	licensePlate?: string;
	color?: string;
	fuelType?: string;
	engineSize?: string;
	transmission?: string;
	mileage?: number;
	lastServiceDate?: Date;
	nextServiceDate?: Date;
	insuranceExpiry?: Date;
	registrationExpiry?: Date;
	createdAt: Date;
	updatedAt: Date;
}

export interface VehicleHealthRecord {
	id: string;
	vehicleId: string;
	userId: string;
	date: Date;
	mileage: number;
	description: string;
	cost?: number;
	serviceProvider?: string;
	notes?: string;
	attachments?: string[];
	tags?: string[];
	createdAt: Date;
	updatedAt: Date;
}

export interface MaintenanceSchedule {
	id: string;
	vehicleId: string;
	userId: string;
	name: string;
	description?: string;
	interval: {
		mileage?: number;
		timeMonths?: number;
	};
	dueMileage?: number;
	dueDate?: Date;
	completed: boolean;
	completedDate?: Date;
	cost?: number;
	serviceProvider?: string;
	notes?: string;
	tags?: string[];
	createdAt: Date;
	updatedAt: Date;
}

export interface VehicleHistoryData {
	vin: string;
	make: string;
	model: string;
	year: number;
	engine: string;
	transmission: string;
	drivetrain: string;
	fuelType: string;
	bodyStyle: string;
	doors: number;
	seats: number;
	msrp?: number;
	features?: string[];
	safetyRatings?: Record<string, unknown>;
	recalls?: Record<string, unknown>[];
	technicalSpecs?: Record<string, unknown>;
	confidence: number;
}
