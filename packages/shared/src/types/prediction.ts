import type { PerformanceMetrics } from "./basic";
import type { UsageMetrics } from "./billing";

export interface AIAnalytics {
	id: string;
	type:
		| "conversation"
		| "recommendation"
		| "prediction"
		| "sentiment"
		| "performance";
	timeRange: {
		start: Date;
		end: Date;
	};
	metrics: AnalyticsMetrics;
	insights: AnalyticsInsight[];
	trends: AnalyticsTrend[];
	predictions: AnalyticsPrediction[];
	generatedAt: Date;
}

export interface AnalyticsMetrics {
	conversations: ConversationMetrics;
	recommendations: RecommendationMetrics;
	performance: PerformanceMetrics;
	satisfaction: SatisfactionMetrics;
	usage: UsageMetrics;
}

export interface ConversationMetrics {
	total: number;
	resolved: number;
	escalated: number;
	averageLength: number;
	averageResponseTime: number;
	topIntents: IntentCount[];
	languages: LanguageCount[];
}

export interface IntentCount {
	intent: string;
	count: number;
	percentage: number;
}

export interface LanguageCount {
	language: string;
	count: number;
	percentage: number;
}

export interface RecommendationMetrics {
	total: number;
	accepted: number;
	rejected: number;
	pending: number;
	acceptanceRate: number;
	averageConfidence: number;
	topCategories: CategoryCount[];
}

export interface CategoryCount {
	category: string;
	count: number;
	percentage: number;
}

export interface SatisfactionMetrics {
	average: number;
	distribution: SatisfactionDistribution[];
	trends: SatisfactionTrend[];
	factors: SatisfactionFactor[];
}

export interface SatisfactionDistribution {
	rating: number;
	count: number;
	percentage: number;
}

export interface SatisfactionTrend {
	date: Date;
	rating: number;
	count: number;
}

export interface SatisfactionFactor {
	factor: string;
	impact: number;
	correlation: number;
}

export interface AnalyticsInsight {
	type: "trend" | "anomaly" | "opportunity" | "risk" | "recommendation";
	title: string;
	description: string;
	impact: "low" | "medium" | "high" | "critical";
	confidence: number;
	data: Record<string, unknown>;
	actions: string[];
}

export interface AnalyticsTrend {
	metric: string;
	direction: "up" | "down" | "stable";
	change: number;
	period: string;
	significance: number;
	forecast: TrendForecast[];
}

export interface TrendForecast {
	date: Date;
	value: number;
	confidence: number;
}

export interface AnalyticsPrediction {
	type: string;
	prediction: string;
	confidence: number;
	timeframe: string;
	factors: PredictionFactor[];
	scenarios: PredictionScenario[];
}

export interface PredictionFactor {
	factor: string;
	importance: number;
	direction: "positive" | "negative" | "neutral";
}

export interface PredictionScenario {
	name: string;
	probability: number;
	outcome: string;
	impact: string;
}

export interface PredictiveInsight {
	id: string;
	vehicleId: string;
	userId: string;
	type:
		| "failure_risk"
		| "cost_forecast"
		| "performance_trend"
		| "maintenance_window"
		| (string & {});
	title: string;
	description: string;
	impact: "critical" | "high" | "medium" | "low";
	confidence: number; // 0-100
	prediction: PredictionDetail;
	timeframe: { start: Date; end: Date };
	recommendations?: string[];
	createdAt: Date;
	expiresAt: Date;
}

export interface PredictionDetail {
	value: number;
	unit: "percentage" | "currency" | "days" | "kilometers" | (string & {});
	range: { min: number; max: number };
	trend: "increasing" | "decreasing" | "stable";
	factors?: PredictionUIFactor[];
}

export interface PredictionUIFactor {
	name: string;
	description?: string;
	impact: number; // 0-100
}
