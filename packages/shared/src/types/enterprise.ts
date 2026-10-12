/**
 * Enterprise Fleet Management Types
 * Comprehensive type definitions for B2B fleet management functionality
 */

import type { Subscription } from "./billing";
import type { ComplianceSettings } from "./compliance";
import type { Organization, ServiceAddress } from "./organization";

// Re-export commonly consumed types so `EnterpriseTypes.X` resolves for consumers
export type { Organization, ServiceAddress } from "./organization";
export type { FleetMetrics } from "./analytics";

// Organization and Multi-Tenancy
export interface EnterpriseOrganization extends Organization {
	industry: string;
	size: "small" | "medium" | "large" | "enterprise";
	contactInfo: ContactInfo;
	subscription: Subscription;
	settings: OrganizationSettings;
}

export interface ContactInfo {
	primaryContact: {
		name: string;
		email: string;
		phone: string;
		title: string;
	};
	billingContact?: {
		name: string;
		email: string;
		phone: string;
	};
}

export interface OrganizationSettings {
	[key: string]: unknown;
	timezone: string;
	locale: string;
	currency: string;
	units: "metric" | "imperial";
	workingHours: {
		start: string; // HH:mm format
		end: string;
		days: number[]; // 0-6, Sunday = 0
	};
	notifications: NotificationSettings;
	compliance: ComplianceSettings;
}

export interface NotificationSettings {
	email: boolean;
	push: boolean;
	sms: boolean;
	channels: {
		maintenance: boolean;
		safety: boolean;
		billing: boolean;
		compliance: boolean;
	};
}

// Fleet Management
export interface Fleet {
	id: string;
	organizationId: string;
	name: string;
	description?: string;
	managerId: string; // User ID of fleet manager
	vehicles: string[]; // Vehicle IDs
	drivers: string[]; // Driver IDs
	operatingRegions: string[]; // Geographic regions
	tags: string[];
	status: "active" | "inactive" | "maintenance";
	createdAt: Date;
	updatedAt: Date;
}
