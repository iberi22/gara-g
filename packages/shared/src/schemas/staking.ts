import { z } from "zod";

export const StakingPositionSchema = z.object({
	id: z.string().uuid().optional(),
	organizationId: z.string().uuid(),
	amount: z.number().positive(),
	apy: z.number().nonnegative(),
	lockPeriod: z.number().int().positive(), // in days
	startDate: z.string().or(z.date()),
	endDate: z.string().or(z.date()),
	status: z.enum(["active", "completed", "withdrawn"]).default("active"),
});

export type StakingPosition = z.infer<typeof StakingPositionSchema>;
