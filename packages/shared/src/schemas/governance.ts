import { z } from "zod";

export const GovernanceProposalSchema = z.object({
	id: z.string().uuid().optional(),
	organizationId: z.string().uuid(),
	title: z.string().min(1),
	description: z.string().min(1),
	proposer: z.string(),
	type: z
		.enum(["parameter_change", "upgrade", "treasury", "general"])
		.default("general"),
	status: z
		.enum([
			"draft",
			"active",
			"succeeded",
			"defeated",
			"queued",
			"executed",
			"cancelled",
		])
		.default("active"),
	votesFor: z.number().nonnegative().default(0),
	votesAgainst: z.number().nonnegative().default(0),
	votesAbstain: z.number().nonnegative().default(0),
	createdAt: z.string().or(z.date()).optional(),
	endDate: z.string().or(z.date()),
});

export const GovernanceVoteSchema = z.object({
	proposalId: z.string().uuid(),
	voter: z.string(),
	choice: z.enum(["for", "against", "abstain"]),
	power: z.number().positive(),
	timestamp: z.string().or(z.date()).optional(),
});

export type GovernanceProposal = z.infer<typeof GovernanceProposalSchema>;
export type GovernanceVote = z.infer<typeof GovernanceVoteSchema>;
