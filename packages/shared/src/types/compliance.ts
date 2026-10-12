export interface ComplianceSettings {
	requiredDocuments: string[];
	inspectionInterval: number; // days
	trainingRequired: boolean;
	regionalRegulations: string[];
}

export interface ComplianceStatus {
	overallStatus: "compliant" | "warning" | "non_compliant";
	lastAuditDate: Date;
	nextAuditDate: Date;
	openIssues: number;
	records: ComplianceRecord[];
}

export interface ComplianceRecord {
	id: string;
	type: "inspection" | "insurance" | "certification" | "training" | "permit";
	title: string;
	status: "valid" | "expired" | "pending" | "warning";
	expiryDate: Date;
	documentUrl?: string;
	notes?: string;
}

export interface DriverCompliance {
	driverId: string;
	licenseNumber: string;
	licenseExpiry: Date;
	certifications: Certification[];
	trainingStatus: TrainingStatus[];
	safetyScore: number;
}

export interface Certification {
	name: string;
	issueDate: Date;
	expiryDate: Date;
	issuingAuthority: string;
	documentUrl?: string;
}

export interface TrainingStatus {
	courseName: string;
	completedDate: Date;
	expiryDate?: Date;
	score?: number;
	status: "completed" | "in_progress" | "not_started" | "expired";
}
