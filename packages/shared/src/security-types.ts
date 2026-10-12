/**
 * Security configuration for GARA-G
 */
export interface SecurityConfig {
	rateLimiting: {
		windowMs: number;
		maxRequests: number;
		burstAllowance: number;
	};
	cors: {
		allowedOrigins: string[];
		allowedMethods: string[];
	};
	headers: {
		helmet: boolean;
		hsts: boolean;
		csp: string;
	};
}

export enum SecurityLevel {
	LOW = "low",
	MEDIUM = "medium",
	HIGH = "high",
	CRITICAL = "critical",
}

export interface SecurityAuditResult {
	id: string;
	timestamp: string;
	level: SecurityLevel;
	category: string;
	description: string;
	status: "passed" | "failed" | "warning";
	remediation?: string;
}
