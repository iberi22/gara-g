export type ComplianceCategory = "vehicle" | "driver" | "operation";
export type ComplianceSeverity = "low" | "medium" | "high" | "critical";
export type ComplianceStatus =
	| "compliant"
	| "non-compliant"
	| "warning"
	| "not-applicable";

export interface ComplianceRule {
	id: string;
	name: string;
	description: string;
	category: ComplianceCategory;
	severity: ComplianceSeverity;
	type: "itv" | "insurance" | "license" | "maintenance" | "other";
}

export interface ComplianceResult {
	ruleId: string;
	status: ComplianceStatus;
	score: number; // 0 to 100
	message?: string;
	lastChecked: string; // ISO date string
	expiryDate?: string; // ISO date string
}

export interface VehicleComplianceScore {
	vehicleId: string;
	overallScore: number;
	results: ComplianceResult[];
}

export interface FleetComplianceSummary {
	organizationId: string;
	totalVehicles: number;
	compliantVehicles: number;
	warningVehicles: number;
	nonCompliantVehicles: number;
	averageScore: number;
	topIssues: Array<{
		ruleId: string;
		count: number;
		severity: ComplianceSeverity;
	}>;
}

export interface ComplianceReport {
	id: string;
	organizationId: string;
	type: "fleet" | "vehicle";
	format: "pdf" | "csv" | "xml";
	generatedAt: string;
	url?: string;
	summary: FleetComplianceSummary;
}

export interface DocumentOCRResult {
	documentType: string;
	confidence: number;
	extractedData: Record<string, any>;
	expiryDate?: string;
	issueDate?: string;
	documentNumber?: string;
}

export interface ExpirationAlert {
	id: string;
	vehicleId: string;
	documentType: string;
	expiryDate: string;
	daysToExpiry: number;
	status: "active" | "resolved" | "dismissed";
	priority: "low" | "medium" | "high";
}
