import { z } from "zod";

export const AIRecommendationRequestSchema = z.object({
	vehicleId: z.string().optional(),
	type: z
		.enum(["maintenance", "performance", "efficiency", "safety"])
		.optional(),
});

export const PartsSearchSchema = z.object({
	query: z.string().min(1),
	vehicleId: z.string().optional(),
	category: z.string().optional(),
	limit: z.number().int().positive().optional(),
});

export const ServiceSearchSchema = z.object({
	query: z.string().min(1),
	location: z
		.object({
			lat: z.number(),
			lng: z.number(),
			radius: z.number().optional(),
		})
		.optional(),
	serviceType: z.string().optional(),
});

export const PredictRequestSchema = z.object({
	vehicleId: z.string().uuid(),
	modelId: z.string().uuid(),
	organizationId: z.string().uuid(),
});

export const ModelsRequestSchema = z.object({
	type: z.string().optional(),
});
