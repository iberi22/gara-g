import { z } from "zod";

export const MeshLocationSchema = z.object({
	lat: z.number(),
	lng: z.number(),
});

export const MeshStatusSchema = z.enum(["online", "offline", "relay"]);

export const DePinNodeSchema = z.object({
	id: z.string(),
	lat: z.number(),
	lng: z.number(),
	status: MeshStatusSchema,
	type: z.enum(["sentinel", "gateway"]),
	peers: z.array(z.string()),
});

export const DePinNodeDetailSchema = z.object({
	deviceId: z.string(),
	firmwareVersion: z.string(),
	status: MeshStatusSchema,
	lastHeartbeat: z.number(),
	batteryLevel: z.number(),
	signalStrength: z.number(),
	connectedPeers: z.array(z.string()),
	storageUsed: z.number(),
	mode: z.enum(["active", "power-save", "emergency"]),
	location: MeshLocationSchema,
});

export const NetworkStatsSchema = z.object({
	throughput: z.number(),
	latency: z.number(),
	packetLoss: z.number(),
	activeNodes: z.number(),
	totalData: z.number(),
	networkHealth: z.number(),
});

export const RegisterNodeSchema = z.object({
	deviceId: z.string(),
	stakeAmount: z.number().positive(),
	organizationId: z.string().optional(),
});

export const HeartbeatSchema = z.object({
	deviceId: z.string(),
	lat: z.number().optional(),
	lng: z.number().optional(),
});

export const ClaimRewardsSchema = z.object({
	organizationId: z.string().optional(),
});
