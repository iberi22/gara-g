export interface MLPipeline {
	id: string;
	name: string;
	description: string;
	version: string;
	status: "draft" | "active" | "paused" | "archived";
	stages: PipelineStage[];
	schedule: PipelineSchedule;
	monitoring: PipelineMonitoring;
	createdAt: Date;
	updatedAt: Date;
}

export interface PipelineStage {
	id: string;
	name: string;
	type:
		| "data_ingestion"
		| "preprocessing"
		| "feature_engineering"
		| "training"
		| "validation"
		| "deployment";
	order: number;
	status: "pending" | "running" | "completed" | "failed" | "skipped";
	configuration: Record<string, unknown>;
	dependencies: string[];
	outputs: string[];
	metrics?: Record<string, number>;
	logs?: string[];
	duration?: number;
	resources?: {
		cpu: number;
		memory: number;
		storage: number;
		timeout: number;
	};
	monitoring?: unknown;
}

export interface PipelineSchedule {
	enabled: boolean;
	type: "cron" | "interval" | "event_driven";
	expression: string;
	timezone: string;
	nextRun?: Date;
	lastRun?: Date;
	interval?: number;
}

export interface PipelineMonitoring {
	enabled: boolean;
	metrics: {
		accuracy: number;
		precision: number;
		recall: number;
		f1Score: number;
		latency: number;
		throughput: number;
		execution?: unknown;
		performance?: unknown;
		quality?: unknown;
		business?: unknown;
	};
	alerts: {
		accuracyThreshold: number;
		latencyThreshold: number;
		errorRateThreshold: number;
		notificationChannels: string[];
	};
	dataQuality: {
		completeness: number;
		consistency: number;
		validity: number;
		freshness: number;
	};
}
