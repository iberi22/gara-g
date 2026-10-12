export interface Subscription {
	plan: "starter" | "professional" | "enterprise" | "custom";
	status: "active" | "suspended" | "cancelled" | "trial";
	vehicleLimit: number;
	userLimit: number;
	features: string[];
	billingCycle: "monthly" | "annual";
	nextBillingDate: Date;
	amount: number;
	currency: string;
}

export interface BillingInfo {
	subscription: Subscription;
	paymentMethod: PaymentMethod;
	billingHistory: Invoice[];
	usage: UsageMetrics;
}

export interface PaymentMethod {
	type: "credit_card" | "bank_transfer" | "crypto";
	details: Record<string, unknown>;
	isDefault: boolean;
}

export interface Invoice {
	id: string;
	number: string;
	date: Date;
	dueDate: Date;
	amount: number;
	currency: string;
	status: "paid" | "unpaid" | "overdue" | "void";
	items: InvoiceItem[];
	pdfUrl?: string;
}

export interface InvoiceItem {
	description: string;
	quantity: number;
	unitPrice: number;
	amount: number;
}

export interface UsageMetrics {
	vehicles: number;
	users: number;
	storage: number;
	apiCalls: number;
	period: {
		start: Date;
		end: Date;
	};
}
