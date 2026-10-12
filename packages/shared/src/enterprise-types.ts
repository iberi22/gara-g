export interface FleetSummary {
	id: string;
	name: string;
	vehicleCount: number;
	activeRoutes: number;
	complianceScore: number;
	monthlyCost: number;
	efficiency: number;
	status: "active" | "inactive" | "maintenance";
}

export interface ComparisonMetric {
	metric: string;
	values: {
		fleetId: string;
		fleetName: string;
		value: number;
	}[];
}

export interface ROIData {
	totalSavings: number;
	subscriptionCost: number;
	netROI: number;
	roiPercentage: number;
	savingsBreakdown: {
		category: string;
		amount: number;
	}[];
}

export interface EnterpriseAlert {
	id: string;
	severity: "low" | "medium" | "high" | "critical";
	message: string;
	fleetId?: string;
	timestamp: string;
	category: "compliance" | "cost" | "safety" | "operational";
}

export interface EnterpriseDashboard {
	fleets: FleetSummary[];
	fleetComparisons: ComparisonMetric[];
	roiAnalytics: ROIData;
	alerts: EnterpriseAlert[];
	kpis: {
		totalVehicles: number;
		activeRoutes: number;
		averageComplianceScore: number;
		totalMonthlyCost: number;
	};
}

export type UserRole = "admin" | "manager" | "viewer";

export interface EnterpriseSubscription {
	tier: "basic" | "pro" | "enterprise";
	status: "active" | "past_due" | "canceled" | "trialing";
	billingCycle: "monthly" | "yearly";
	nextBillingDate: string;
	limits: {
		maxVehicles: number;
		maxFleets: number;
		maxUsers: number;
	};
	usage?: {
		apiCalls: number;
		apiLimit: number;
		storage: number;
		storageLimit: number;
	};
	billingHistory?: InvoiceEntry[];
}

export interface InvoiceEntry {
	date: string;
	amount: number;
	status: "Paid" | "Pending" | "Overdue";
	invoiceId?: string;
}
