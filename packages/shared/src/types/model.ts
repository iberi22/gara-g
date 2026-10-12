import type { GeographicLocation, PerformanceMetrics } from "./basic";
import type { MaintenanceRecord } from "./blockchain";

export interface RateLimits {
	requestsPerMinute: number;
	tokensPerMinute?: number;
	burst?: number;
	concurrentRequests?: number;
}

export interface AICapability {
	type:
		| "text_generation"
		| "text_analysis"
		| "code_generation"
		| "translation"
		| "summarization"
		| "qa"
		| "classification"
		| "sentiment_analysis"
		| "entity_extraction"
		| "image_generation"
		| "image_analysis"
		| "audio_transcription"
		| "audio_generation";
	available: boolean;
	quality?: "basic" | "good" | "excellent" | "state_of_art";
}

export interface AIProvider {
	id: string;
	name: string;
	type: "openai" | "anthropic" | "google" | "custom";
	apiKey: string;
	baseUrl?: string;
	version: string;
	models: AIModel[];
	rateLimits: RateLimits;
	capabilities: AICapability[];
	status: "active" | "inactive" | "error";
	createdAt: Date;
	updatedAt: Date;
}

export interface AIModel {
	id: string;
	name: string;
	provider: string;
	type: "text" | "image" | "audio" | "multimodal";
	capabilities: ModelCapability[];
	contextLength: number;
	maxTokens: number;
	pricing: ModelPricing;
	performance: ModelPerformance;
	availability: ModelAvailability;
}

export interface ModelCapability {
	type:
		| "text_generation"
		| "text_analysis"
		| "code_generation"
		| "translation"
		| "summarization"
		| "qa"
		| "classification"
		| "sentiment_analysis"
		| "entity_extraction"
		| "image_generation"
		| "image_analysis"
		| "audio_transcription"
		| "audio_generation";
	quality: "basic" | "good" | "excellent" | "state_of_art";
	languages?: string[];
	specializations?: string[];
}

export interface ModelPricing {
	inputTokens: number; // per 1K tokens
	outputTokens: number; // per 1K tokens
	currency: string;
	billingModel: "pay_per_use" | "subscription" | "credits";
}

export interface ModelPerformance {
	latency: {
		p50: number;
		p95: number;
		p99: number;
	};
	throughput: number; // tokens per second
	accuracy: number; // 0-100
	reliability: number; // 0-100
}

export interface ModelAvailability {
	regions: string[];
	uptime: number; // percentage
	maintenance: MaintenanceWindow[];
}

export interface MaintenanceWindow {
	start: Date;
	end: Date;
	description: string;
	impact: "none" | "low" | "medium" | "high";
}

export interface PredictiveModel {
	id: string;
	name: string;
	version: string;
	description?: string;
	lastTrainedAt?: Date;
	metrics?: {
		accuracy?: number;
		precision?: number;
		recall?: number;
	};
}
