export interface GeminiVINResponse {
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
