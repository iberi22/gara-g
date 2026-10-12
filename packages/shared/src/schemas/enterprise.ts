import { z } from "zod";

export const OrganizationSchema = z.object({
	id: z.string().uuid().optional(),
	name: z.string().min(1, "Name is required"),
	type: z
		.enum(["enterprise", "small_business", "government", "nonprofit"])
		.default("enterprise"),
	industry: z.string().optional(),
	size: z.string().optional(),
	address: z.any().optional(),
	contactInfo: z.any().optional(),
	settings: z.any().optional(),
	createdAt: z.date().optional(),
	updatedAt: z.date().optional(),
});

export const SubscriptionSchema = z.object({
	id: z.string().uuid().optional(),
	organizationId: z.string().uuid(),
	tier: z.enum(["basic", "pro", "enterprise"]).default("basic"),
	status: z
		.enum(["active", "past_due", "canceled", "trialing"])
		.default("trialing"),
	billingCycle: z.enum(["monthly", "yearly"]),
	nextBillingDate: z.date().or(z.string()),
	maxVehicles: z.number().int().nonnegative(),
	maxFleets: z.number().int().nonnegative(),
	maxUsers: z.number().int().nonnegative(),
	amount: z.number().nonnegative(),
	currency: z.string().default("USD"),
});

export const DriverSchema = z.object({
	id: z.string().uuid().optional(),
	organizationId: z.string().uuid(),
	firstName: z.string().min(1),
	lastName: z.string().min(1),
	email: z.string().email(),
	phone: z.string().optional(),
	licenseNumber: z.string().optional(),
	status: z.string().optional(),
});

export const VehicleSchema = z.object({
	id: z.string().uuid().optional(),
	organizationId: z.string().uuid(),
	name: z.string().min(1),
	vin: z.string().optional(),
	make: z.string().optional(),
	model: z.string().optional(),
	year: z.number().int().optional(),
	status: z.string().optional(),
});

export const FleetMetricsSchema = z.object({
	totalVehicles: z.number(),
	activeVehicles: z.number(),
	totalDrivers: z.number(),
	activeDrivers: z.number(),
	totalMileage: z.number(),
	fuelConsumption: z.number(),
	maintenanceCosts: z.number(),
	operatingCosts: z.number(),
	utilizationRate: z.number(),
	safetyScore: z.number(),
	efficiencyScore: z.number(),
	complianceScore: z.number(),
});

export const EnterpriseAlertSchema = z.object({
	id: z.string().uuid().optional(),
	severity: z.enum(["low", "medium", "high", "critical"]),
	message: z.string(),
	category: z.enum(["compliance", "cost", "safety", "operational"]),
	fleetId: z.string().optional(),
	timestamp: z.string().or(z.date()),
});

export const ExchangeDataSchema = z.object({
	success: z.boolean(),
	timestamp: z.string(),
	network: z.string(),
	programId: z.string(),
	programExists: z.boolean(),
	marketData: z.object({
		pairs: z.array(
			z.object({
				name: z.string(),
				price: z.number(),
				change24h: z.number(),
				volume24h: z.number(),
			}),
		),
		orderBook: z.object({
			asks: z.array(z.object({ price: z.number(), amount: z.number() })),
			bids: z.array(z.object({ price: z.number(), amount: z.number() })),
		}),
		recentTrades: z.array(
			z.object({
				type: z.enum(["buy", "sell"]),
				price: z.number(),
				amount: z.number(),
				time: z.string(),
			}),
		),
	}),
	oracleData: z.object({
		feeds: z.array(
			z.object({
				source: z.string(),
				price: z.number(),
				status: z.string(),
			}),
		),
		aggregatePrice: z.number(),
		deviation: z.number(),
	}),
});

export const ReportRequestSchema = z.object({
	organizationId: z.string().uuid(),
	reportType: z.enum([
		"fleet_usage",
		"fuel_efficiency",
		"safety_compliance",
		"cost_analysis",
	]),
	dateRange: z.object({
		start: z.string().or(z.date()),
		end: z.string().or(z.date()),
	}),
});

export const EnterpriseSettingsSchema = z.object({
	organizationId: z.string().uuid(),
	settings: z.object({
		notifications: z
			.object({
				email: z.boolean(),
				push: z.boolean(),
				slack: z.boolean(),
			})
			.optional(),
		compliance: z
			.object({
				autoReport: z.boolean(),
				threshold: z.number(),
			})
			.optional(),
		fleet: z
			.object({
				defaultRadius: z.number(),
				unitSystem: z.enum(["metric", "imperial"]),
			})
			.optional(),
	}),
});

export const UpgradeSubscriptionSchema = z.object({
	organizationId: z.string(),
	tier: z.enum(["basic", "pro", "enterprise"]),
});

export const CancelSubscriptionSchema = z.object({
	organizationId: z.string(),
});

export const StakingRequestSchema = z.object({
	organizationId: z.string(),
	amount: z.number().positive(),
});

export const StakingClaimSchema = z.object({
	organizationId: z.string(),
});

export const CreateProposalSchema = z.object({
	title: z.string().min(1),
	description: z.string().min(1),
	organizationId: z.string(),
});

export const VoteSchema = z.object({
	proposalId: z.string().or(z.number()),
	choice: z.string(),
});

export const ClaimVestingSchema = z.object({
	scheduleId: z.string(),
});

export const SwapSchema = z.object({
	from: z.string(),
	to: z.string(),
	amount: z.number().positive().or(z.string()),
});

// ────────── Geofencing Schemas ──────────

export const LatLngSchema = z.object({
	lat: z.number(),
	lng: z.number(),
});

export const GeofenceZoneBaseSchema = z.object({
	id: z.string().uuid().optional(),
	organizationId: z.string().uuid(),
	name: z.string().min(1, "Zone name is required"),
	description: z.string().optional(),
	type: z.enum(["circular", "polygon"]),
	center: LatLngSchema.optional(),
	radius: z.number().int().positive().optional(),
	coordinates: z.array(LatLngSchema).min(3).optional(),
	active: z.boolean().default(true),
	alertOnEntry: z.boolean().default(true),
	alertOnExit: z.boolean().default(true),
	metadata: z.record(z.string(), z.unknown()).optional(),
	createdAt: z.date().optional(),
	updatedAt: z.date().optional(),
});

const geofenceRefinement = (data: any) => {
	if (data.type === "circular") return !!data.center && !!data.radius;
	if (data.type === "polygon")
		return !!data.coordinates && data.coordinates.length >= 3;
	return true;
};

const geofenceRefinementError = {
	message: "Circular zones need center+radius, polygon zones need 3+ points",
};

export const GeofenceZoneSchema = GeofenceZoneBaseSchema.refine(
	geofenceRefinement,
	geofenceRefinementError,
);

export const CreateGeofenceZoneSchema = GeofenceZoneBaseSchema.omit({
	id: true,
	createdAt: true,
	updatedAt: true,
}).refine(geofenceRefinement, geofenceRefinementError);

export const UpdateGeofenceZoneSchema = GeofenceZoneBaseSchema.omit({
	id: true,
	createdAt: true,
	updatedAt: true,
}).partial();

export const GeofenceAlertSchema = z.object({
	id: z.string().uuid().optional(),
	organizationId: z.string().uuid(),
	zoneId: z.string().uuid(),
	vehicleId: z.string(),
	event: z.enum(["entry", "exit"]),
	location: LatLngSchema,
	timestamp: z.date().optional(),
	notified: z.boolean().default(false),
});

export const ZoneAlertQuerySchema = z.object({
	zoneId: z.string().uuid(),
	limit: z.coerce.number().int().positive().default(50),
	offset: z.coerce.number().int().nonnegative().default(0),
});

export const CheckZoneStatusSchema = z.object({
	vehicleId: z.string(),
	location: LatLngSchema,
});

export type GeofenceZone = z.infer<typeof GeofenceZoneSchema>;
export type CreateGeofenceZone = z.infer<typeof CreateGeofenceZoneSchema>;
export type UpdateGeofenceZone = z.infer<typeof UpdateGeofenceZoneSchema>;
export type GeofenceAlert = z.infer<typeof GeofenceAlertSchema>;

// =================== Fleet Schemas ===================

export const FleetSchema = z.object({
	id: z.string().uuid().optional(),
	organizationId: z.string().min(1, "Organization ID is required"),
	name: z.string().min(1, "Fleet name is required").max(100),
	description: z.string().max(500).optional(),
	managerId: z.string().optional(),
	vehicleIds: z.array(z.string()).optional().default([]),
	driverIds: z.array(z.string()).optional().default([]),
	operatingRegions: z.array(z.string()).optional().default([]),
	tags: z.array(z.string()).optional().default([]),
	status: z.enum(["active", "inactive", "maintenance"]).default("active"),
	metadata: z.record(z.string(), z.unknown()).optional(),
	createdAt: z.string().or(z.date()).optional(),
	updatedAt: z.string().or(z.date()).optional(),
});

// FleetSummary for list views (subset of Fleet)
export const FleetSummarySchema = z.object({
	id: z.string(),
	organizationId: z.string(),
	name: z.string(),
	description: z.string().optional(),
	vehicleCount: z.number().int().nonnegative(),
	activeVehicles: z.number().int().nonnegative(),
	driverCount: z.number().int().nonnegative(),
	status: z.enum(["active", "inactive", "maintenance"]),
	alertCount: z.number().int().nonnegative().default(0),
	maintenanceDue: z.number().int().nonnegative().default(0),
	avgEfficiency: z.number().min(0).max(100).optional(),
	monthlyCost: z.number().nonnegative().optional(),
	createdAt: z.string().or(z.date()).optional(),
});

export const CreateFleetSchema = z.object({
	organizationId: z.string().min(1, "Organization ID is required"),
	name: z.string().min(1, "Fleet name is required").max(100),
	description: z.string().max(500).optional(),
	managerId: z.string().optional(),
	operatingRegions: z.array(z.string()).optional(),
	tags: z.array(z.string()).optional(),
	status: z.enum(["active", "inactive", "maintenance"]).optional(),
});

export const UpdateFleetSchema = z.object({
	name: z.string().min(1).max(100).optional(),
	description: z.string().max(500).optional(),
	managerId: z.string().optional(),
	vehicleIds: z.array(z.string()).optional(),
	driverIds: z.array(z.string()).optional(),
	operatingRegions: z.array(z.string()).optional(),
	tags: z.array(z.string()).optional(),
	status: z.enum(["active", "inactive", "maintenance"]).optional(),
	metadata: z.record(z.string(), z.unknown()).optional(),
});

export const AddVehicleToFleetSchema = z.object({
	vehicleId: z.string().min(1, "Vehicle ID is required"),
});

export const FleetListQuerySchema = z.object({
	organizationId: z.string().optional(),
	status: z.enum(["active", "inactive", "maintenance"]).optional(),
	search: z.string().optional(),
	page: z.string().optional().default("1").transform(Number),
	limit: z.string().optional().default("20").transform(Number),
	sortBy: z
		.enum(["name", "createdAt", "vehicleCount", "status"])
		.optional()
		.default("createdAt"),
	sortOrder: z.enum(["asc", "desc"]).optional().default("desc"),
});

export const FleetStatsSchema = z.object({
	totalFleets: z.number().int().nonnegative(),
	totalVehicles: z.number().int().nonnegative(),
	activeVehicles: z.number().int().nonnegative(),
	totalDrivers: z.number().int().nonnegative(),
	alertsBySeverity: z.object({
		critical: z.number().int().nonnegative().default(0),
		high: z.number().int().nonnegative().default(0),
		medium: z.number().int().nonnegative().default(0),
		low: z.number().int().nonnegative().default(0),
	}),
	maintenanceDue: z.number().int().nonnegative().default(0),
});
// Subscription Plans & Invoices (complete)
export const SubscriptionPlanSchema = z.object({
	id: z.string(),
	name: z.string(),
	tier: z.enum(["basic", "pro", "enterprise"]),
	price: z.number(),
	currency: z.string().default("USD"),
	billingCycle: z.enum(["monthly", "yearly"]),
	features: z.array(
		z.object({
			name: z.string(),
			included: z.boolean(),
			limit: z.string().optional(),
		}),
	),
	limits: z.object({
		maxVehicles: z.number(),
		maxFleets: z.number(),
		maxUsers: z.number(),
	}),
	popular: z.boolean().default(false),
});

export const InvoiceSchema = z.object({
	id: z.string(),
	organizationId: z.string(),
	subscriptionTier: z.enum(["basic", "pro", "enterprise"]),
	amount: z.number(),
	currency: z.string().default("USD"),
	status: z.enum(["pending", "paid", "overdue", "canceled"]),
	periodStart: z.string(),
	periodEnd: z.string(),
	issuedAt: z.string(),
	paidAt: z.string().optional(),
	items: z.array(
		z.object({
			description: z.string(),
			quantity: z.number(),
			unitPrice: z.number(),
			total: z.number(),
		}),
	),
});

export const PaymentMethodSchema = z.object({
	id: z.string(),
	organizationId: z.string(),
	type: z.enum(["card", "crypto", "wire"]),
	last4: z.string().optional(),
	brand: z.string().optional(),
	expMonth: z.number().optional(),
	expYear: z.number().optional(),
	isDefault: z.boolean(),
});

export const UpdatePaymentMethodSchema = z.object({
	organizationId: z.string(),
	paymentMethodId: z.string(),
});

export const CreateSubscriptionSchema = z.object({
	organizationId: z.string(),
	tier: z.enum(["basic", "pro", "enterprise"]),
	billingCycle: z.enum(["monthly", "yearly"]).default("monthly"),
});

export const CancelSubscriptionInputSchema = z.object({
	organizationId: z.string(),
	reason: z.string().optional(),
	immediate: z.boolean().default(false),
});

export const UsageRecordSchema = z.object({
	feature: z.string(),
	current: z.number(),
	limit: z.number(),
	unit: z.string(),
	period: z.string(),
});

// Full subscription with usage response (GET /subscriptions/current)
export const CurrentSubscriptionSchema = z.object({
	tier: z.enum(["basic", "pro", "enterprise"]),
	status: z.enum(["active", "past_due", "canceled", "trialing"]),
	billingCycle: z.enum(["monthly", "yearly"]),
	nextBillingDate: z.string(),
	limits: z.object({
		maxVehicles: z.number(),
		maxFleets: z.number(),
		maxUsers: z.number(),
	}),
	usage: z.array(UsageRecordSchema),
	paymentMethod: PaymentMethodSchema.optional().nullable(),
});

export const PlansResponseSchema = z.object({
	success: z.boolean(),
	data: z.array(SubscriptionPlanSchema),
});

export const InvoicesResponseSchema = z.object({
	success: z.boolean(),
	data: z.array(InvoiceSchema),
	total: z.number().optional(),
});

// ────────── Tracking Schemas ──────────

export const TrackingEventSchema = z.object({
	id: z.string().uuid().optional(),
	vehicleId: z.string().uuid(),
	organizationId: z.string().uuid(),
	latitude: z.number().min(-90).max(90),
	longitude: z.number().min(-180).max(180),
	heading: z.number().min(0).max(360).optional(),
	speed: z.number().min(0).optional(),
	timestamp: z.string().or(z.date()).optional(),
	metadata: z.record(z.string(), z.unknown()).optional(),
});

export const CreateTrackingEventSchema = TrackingEventSchema.omit({
	id: true,
	timestamp: true,
});

export const TrackingHistoryQuerySchema = z.object({
	vehicleId: z.string().uuid().optional(),
	limit: z.coerce.number().int().positive().default(100),
	offset: z.coerce.number().int().nonnegative().default(0),
	startDate: z.string().or(z.date()).optional(),
	endDate: z.string().or(z.date()).optional(),
});

export type TrackingEvent = z.infer<typeof TrackingEventSchema>;
export type CreateTrackingEvent = z.infer<typeof CreateTrackingEventSchema>;

export type CurrentSubscription = z.infer<typeof CurrentSubscriptionSchema>;
export type SubscriptionPlan = z.infer<typeof SubscriptionPlanSchema>;
export type Invoice = z.infer<typeof InvoiceSchema>;
export type PaymentMethod = z.infer<typeof PaymentMethodSchema>;
export type UsageRecord = z.infer<typeof UsageRecordSchema>;
