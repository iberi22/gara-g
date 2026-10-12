export interface GeographicLocation {
	latitude: number;
	longitude: number;
	altitude?: number;
	accuracy?: number; // meters
	placeName?: string;
	countryCode?: string; // ISO 3166-1 alpha-2
}

export interface SystemHealthRecord {
	system: string;
	health: number; // 0-100
	status: "excellent" | "good" | "fair" | "poor" | "critical";
	lastMaintenance?: Date;
	nextMaintenance?: Date;
}

export interface HealthRecommendation {
	id: string;
	type: "maintenance" | "repair" | "replacement" | "inspection";
	priority: "low" | "medium" | "high" | "urgent";
	description: string;
	estimatedCost?: number;
	timeframe: string;
}

export interface HealthAlert {
	id: string;
	severity: "info" | "warning" | "error" | "critical";
	message: string;
	system?: string;
	actionRequired: boolean;
}

export interface DashboardWidget {
	id: string;
	type: "speedometer" | "fuel" | "temperature" | "rpm" | "maintenance" | "map";
	position: { x: number; y: number };
	size: { width: number; height: number };
	visible: boolean;
	configuration: Record<string, unknown>;
}

export interface SecurityAudit {
	status: "pending" | "in_progress" | "completed" | "failed";
	auditor?: string;
	report?: SecurityReport;
	score?: number;
	issues: SecurityIssue[];
	recommendations: string[];
	auditedAt?: Date;
}

export interface SecurityReport {
	id: string;
	auditor: string;
	version: string;
	summary: string;
	methodology: string;
	findings: SecurityFinding[];
	recommendations: SecurityRecommendation[];
	score: number;
	createdAt: Date;
}

export interface SecurityFinding {
	id: string;
	severity: "critical" | "high" | "medium" | "low" | "informational";
	category: string;
	title: string;
	description: string;
	location: string;
	impact: string;
	recommendation: string;
	status: "open" | "acknowledged" | "fixed" | "false_positive";
}

export interface SecurityRecommendation {
	id: string;
	priority: "high" | "medium" | "low";
	category: string;
	title: string;
	description: string;
	implementation: string;
	effort: "low" | "medium" | "high";
}

export interface SecurityIssue {
	type: "vulnerability" | "warning" | "optimization";
	severity: "critical" | "high" | "medium" | "low";
	title: string;
	description: string;
	location: string;
	recommendation: string;
	fixed: boolean;
}

export interface SecurityAlert {
	id: string;
	type:
		| "suspicious_transaction"
		| "phishing_attempt"
		| "unauthorized_access"
		| "low_balance"
		| "high_gas";
	severity: "low" | "medium" | "high" | "critical";
	message: string;
	timestamp: Date;
	acknowledged: boolean;
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
