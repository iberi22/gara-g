import type { AIProvider } from "./model";
import type { AISecurity } from "./aiIntegration";

export interface AIConfiguration {
	providers: AIProvider[];
	routing: AIRouting;
	fallback: AIFallback;
	monitoring: AIMonitoring;
	security: AISecurity;
	optimization: AIOptimization;
}

export interface AIRouting {
	rules: RoutingRule[];
	loadBalancing: LoadBalancingStrategy;
	failover: FailoverStrategy;
}

export interface RoutingRule {
	condition: string;
	provider: string;
	model: string;
	priority: number;
	weight: number;
}

export interface LoadBalancingStrategy {
	type: "round_robin" | "weighted" | "least_connections" | "response_time";
	parameters: Record<string, unknown>;
}

export interface FailoverStrategy {
	enabled: boolean;
	maxRetries: number;
	backoffStrategy: "linear" | "exponential";
	fallbackProviders: string[];
}

export interface AIFallback {
	enabled: boolean;
	triggers: FallbackTrigger[];
	actions: FallbackAction[];
}

export interface FallbackTrigger {
	type: "error" | "timeout" | "rate_limit" | "quality" | "cost";
	threshold: number;
	duration: number;
}

export interface FallbackAction {
	type: "switch_provider" | "switch_model" | "cache_response" | "human_handoff";
	parameters: Record<string, unknown>;
}

export interface AIMonitoring {
	metrics: MonitoringMetric[];
	alerts: MonitoringAlert[];
	dashboards: MonitoringDashboard[];
}

export interface MonitoringMetric {
	name: string;
	type: "counter" | "gauge" | "histogram" | "summary";
	labels: string[];
	retention: string;
}

export interface MonitoringAlert {
	name: string;
	condition: string;
	severity: "info" | "warning" | "critical";
	channels: string[];
	cooldown: number;
}

export interface MonitoringDashboard {
	name: string;
	panels: DashboardPanel[];
	refresh: number;
	timeRange: string;
}

export interface DashboardPanel {
	title: string;
	type: "graph" | "table" | "stat" | "heatmap";
	query: string;
	visualization: Record<string, unknown>;
}

export interface AIOptimization {
	caching: CachingConfig;
	batching: BatchingConfig;
	compression: CompressionConfig;
	prefetching: PrefetchingConfig;
}

export interface CachingConfig {
	enabled: boolean;
	ttl: number;
	maxSize: number;
	strategy: "lru" | "lfu" | "fifo";
}

export interface BatchingConfig {
	enabled: boolean;
	maxSize: number;
	maxWait: number;
	strategy: "size" | "time" | "adaptive";
}

export interface CompressionConfig {
	enabled: boolean;
	algorithm: "gzip" | "brotli" | "lz4";
	level: number;
}

export interface PrefetchingConfig {
	enabled: boolean;
	strategies: string[];
	cacheSize: number;
	accuracy: number;
}
