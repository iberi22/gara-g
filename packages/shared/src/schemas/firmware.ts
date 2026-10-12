import { z } from "zod";

export const OTACheckSchema = z.object({
	version: z.string(),
});

export const OTAResponseSchema = z.object({
	upToDate: z.boolean(),
	latestVersion: z.string().optional(),
	downloadUrl: z.string().url().optional(),
	releaseNotes: z.array(z.string()).optional(),
	size: z.number().optional(),
	checksum: z.string().optional(),
});
