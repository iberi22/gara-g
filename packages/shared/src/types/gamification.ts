import type { AchievementRequirement } from "./user";

export interface PointTransaction {
	id: string;
	userId: string;
	points: number;
	type: "earned" | "spent";
	source: string; // e.g., 'achievement', 'forum', 'vehicle', etc.
	description: string;
	metadata?: Record<string, unknown>;
	createdAt: Date;
}

export interface Achievement {
	id: string;
	name: string;
	description: string;
	icon?: string; // emoji or icon key
	category: "vehicle" | "maintenance" | "social" | "performance" | string;
	points: number;
	requirements: AchievementRequirement;
	rarity: "common" | "uncommon" | "rare" | "epic" | "legendary";
	isActive: boolean;
	createdAt: Date;
	updatedAt: Date;
}

export interface UserAchievement {
	id: string;
	userId: string;
	achievementId: string;
	unlockedAt: Date;
	progress: number; // 0-100
	isCompleted: boolean;
}
