import { z } from "zod";

export const VestingScheduleSchema = z.object({
	id: z.string().uuid().optional(),
	organizationId: z.string().uuid(),
	grantee: z.string(),
	totalAmount: z.number().positive(),
	cliffPeriod: z.number().int().nonnegative(), // days before first unlock
	vestingPeriod: z.number().int().positive(), // total vesting days
	tgeUnlock: z.number().min(0).max(100), // % unlocked at TGE
	schedule: z.enum(["linear", "graded"]).default("linear"),
	startDate: z.string().or(z.date()),
});

export type VestingSchedule = z.infer<typeof VestingScheduleSchema>;
