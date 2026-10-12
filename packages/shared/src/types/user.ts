export interface SocialProfile {
	bio?: string;
	location?: string;
	website?: string;
	links?: Record<string, string>;
	// Controls public visibility of profile details
	isPublic?: boolean;
}

export interface GamificationStats {
	totalPoints: number;
	level: number;
	achievements: number;
}

export interface UserProfile {
	id: string;
	displayName: string;
	email?: string;
	photoURL?: string;
	isPublic: boolean;
	garageName?: string;
	socialProfile?: SocialProfile;
	gamification?: GamificationStats;
	createdAt: Date;
	updatedAt: Date;
}

export interface SocialActivity {
	id: string;
	userId: string;
	type: string;
	content: string;
	timestamp: Date;
	likes: number | string[];
	comments: number | string[];
	title?: string;
	description?: string;
	createdAt?: Date;
	metadata?: Record<string, unknown>;
}

export interface UserPreferences {
	id: string;
	userId: string;
	preferences: unknown;
	updatedAt: Date;
}

export interface AchievementRequirement {
	type:
		| "vehicle_count"
		| "maintenance_count"
		| "following_count"
		| "followers_count"
		| "forum_posts"
		| "routes_completed"
		| "total_distance"
		| "points_total";
	value: number;
	condition?: "greater_than_or_equal" | "equal" | "less_than_or_equal";
}
