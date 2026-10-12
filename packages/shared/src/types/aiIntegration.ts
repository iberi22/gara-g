// AI Integration Types for Phase 6
import type { GeographicLocation, PerformanceMetrics } from "./basic";
import type { MaintenanceRecord } from "./blockchain";
import type { PolicyRule } from "./identity";

export interface AIConversation {
	id: string;
	userId: string;
	vehicleId?: string;
	title: string;
	context: ConversationContext;
	messages: AIMessage[];
	metadata: ConversationMetadata;
	status: "active" | "paused" | "completed" | "error";
	createdAt: Date;
	updatedAt: Date;
}

export interface ConversationContext {
	type:
		| "general"
		| "vehicle_support"
		| "maintenance"
		| "purchase"
		| "technical"
		| "emergency";
	vehicleData?: VehicleContext;
	sessionData?: SessionData;
	history?: ConversationHistory;
}

export interface VehicleContext {
	vehicleId: string;
	make: string;
	model: string;
	year: number;
	vin?: string;
	mileage?: number;
	lastService?: Date;
	currentIssues?: string[];
	maintenanceHistory?: MaintenanceRecord[];
}

export interface UserPreferences {
	language: string;
	communicationStyle: "formal" | "casual" | "technical" | "simple";
	expertise: "beginner" | "intermediate" | "expert";
	interests: string[];
	previousInteractions: number;
}

export interface SessionData {
	sessionId: string;
	startTime: Date;
	location?: GeographicLocation;
	device: DeviceInfo;
	referrer?: string;
}

export interface DeviceInfo {
	type: "mobile" | "desktop" | "tablet" | "voice" | "car";
	os: string;
	browser?: string;
	version: string;
	capabilities: string[];
}

export interface ConversationHistory {
	previousConversations: number;
	commonTopics: string[];
	satisfactionRating: number;
	resolvedIssues: number;
	escalations: number;
}

export interface AIMessage {
	id: string;
	conversationId: string;
	role: "user" | "assistant" | "system" | "function";
	content: MessageContent;
	metadata: MessageMetadata;
	timestamp: Date;
	processed: boolean;
}

export interface MessageContent {
	text?: string;
	images?: ImageContent[];
	audio?: AudioContent;
	attachments?: Attachment[];
	actions?: MessageAction[];
	suggestions?: string[];
}

export interface ImageContent {
	url: string;
	alt: string;
	type: "photo" | "diagram" | "chart" | "screenshot";
	analysis?: ImageAnalysis;
}

export interface ImageAnalysis {
	description?: string;
	labels?: { name: string; confidence: number }[];
	objects?: {
		name: string;
		confidence: number;
		boundingBox?: { x: number; y: number; width: number; height: number };
	}[];
	text?: { content: string; language?: string; confidence?: number }[];
	dominantColors?: {
		hex: string;
		r: number;
		g: number;
		b: number;
		percentage: number;
	}[];
	nsfw?: {
		isNSFW: boolean;
		score: number;
		categories?: { name: string; score: number }[];
	};
	quality?: {
		sharpness?: number;
		brightness?: number;
		contrast?: number;
		noise?: number;
	};
	metadata?: Record<string, unknown>;
}

export interface AudioContent {
	url: string;
	duration: number;
	format: string;
	transcription?: string;
	language?: string;
}

export interface Attachment {
	id: string;
	name: string;
	type: string;
	size: number;
	url: string;
	description?: string;
}

export interface MessageAction {
	type: "button" | "link" | "form" | "calendar" | "payment" | "call";
	label: string;
	action: string;
	parameters?: Record<string, unknown>;
	style?: ActionStyle;
}

export interface ActionStyle {
	variant: "primary" | "secondary" | "danger" | "success";
	size: "small" | "medium" | "large";
	icon?: string;
}

export interface MessageMetadata {
	modelUsed: string;
	processingTime: number;
	tokensUsed: TokenUsage;
	confidence: number;
	intent?: IntentAnalysis;
	entities?: EntityExtraction[];
	sentiment?: SentimentAnalysis;
	language?: string;
	safety?: SafetyCheck;
}

export interface TokenUsage {
	input: number;
	output: number;
	total: number;
	cost: number;
}

export interface IntentAnalysis {
	intent: string;
	confidence: number;
	alternatives: IntentAlternative[];
	parameters: Record<string, unknown>;
}

export interface IntentAlternative {
	intent: string;
	confidence: number;
}

export interface EntityExtraction {
	entity: string;
	type: string;
	value: string;
	confidence: number;
	start: number;
	end: number;
}

export interface SentimentAnalysis {
	sentiment: "positive" | "negative" | "neutral";
	confidence: number;
	emotions: EmotionScore[];
}

export interface EmotionScore {
	emotion: string;
	score: number;
}

export interface SafetyCheck {
	safe: boolean;
	categories: SafetyCategory[];
	flagged: boolean;
	reason?: string;
}

export interface SafetyCategory {
	category: string;
	flagged: boolean;
	score: number;
}

export interface ConversationMetadata {
	totalMessages: number;
	totalTokens: number;
	totalCost: number;
	averageResponseTime: number;
	satisfactionRating?: number;
	resolved: boolean;
	escalated: boolean;
	tags: string[];
	priority: "low" | "medium" | "high" | "urgent";
}

export interface AIRecommendation {
	id: string;
	userId: string;
	vehicleId?: string;
	type:
		| "maintenance"
		| "purchase"
		| "upgrade"
		| "service"
		| "insurance"
		| "financing";
	title: string;
	description: string;
	reasoning: string;
	confidence: number;
	priority: "low" | "medium" | "high" | "urgent";
	category: string;
	tags: string[];
	data: RecommendationData;
	actions: RecommendationAction[];
	timeline: RecommendationTimeline;
	impact: RecommendationImpact;
	status: "pending" | "viewed" | "accepted" | "rejected" | "expired";
	createdAt: Date;
	expiresAt?: Date;
}

export interface RecommendationData {
	products?: Product[];
	services?: Service[];
	parts?: Part[];
	estimates?: CostEstimate[];
	alternatives?: Alternative[];
	comparisons?: Comparison[];
}

export interface Product {
	id: string;
	name: string;
	brand: string;
	model: string;
	price: number;
	rating: number;
	availability: string;
	compatibility: string[];
	features: string[];
}

export interface Service {
	id: string;
	name: string;
	provider: string;
	price: number;
	duration: string;
	rating: number;
	location: string;
	availability: string[];
}

export interface Part {
	id: string;
	name: string;
	partNumber: string;
	brand: string;
	price: number;
	condition: "new" | "used" | "refurbished";
	warranty: string;
	compatibility: string[];
}

export interface CostEstimate {
	type: string;
	low: number;
	high: number;
	average: number;
	currency: string;
	factors: string[];
}

export interface Alternative {
	id: string;
	name: string;
	description: string;
	pros: string[];
	cons: string[];
	cost: number;
	timeframe: string;
}

export interface Comparison {
	criteria: string;
	options: ComparisonOption[];
	recommendation: string;
}

export interface ComparisonOption {
	name: string;
	score: number;
	pros: string[];
	cons: string[];
	cost: number;
}

export interface RecommendationAction {
	type: "view" | "purchase" | "schedule" | "contact" | "learn_more" | "compare";
	label: string;
	url?: string;
	parameters?: Record<string, unknown>;
	primary: boolean;
}

export interface RecommendationTimeline {
	urgency:
		| "immediate"
		| "within_week"
		| "within_month"
		| "within_quarter"
		| "flexible";
	deadline?: Date;
	milestones: TimelineMilestone[];
}

export interface TimelineMilestone {
	name: string;
	date: Date;
	description: string;
	completed: boolean;
}

export interface RecommendationImpact {
	cost: {
		immediate: number;
		longTerm: number;
		savings: number;
	};
	benefits: string[];
	risks: string[];
	roi: number;
	paybackPeriod: string;
}

export interface VehicleDamageAssessment {
	id: string;
	vehicleId: string;
	userId: string;
	images: DamageImage[];
	analysis: DamageAnalysisSummary;
	estimatedCost: CostEstimate;
	severity: "minor" | "moderate" | "severe";
	priority: "low" | "medium" | "high";
	recommendations: RepairRecommendation[];
	status: "pending" | "in_progress" | "completed" | "cancelled";
	createdAt: Date;
	updatedAt: Date;
}

export interface DamageImage {
	id: string;
	url: string;
	thumbnail?: string;
	metadata?: {
		width?: number;
		height?: number;
		fileSize?: number;
		format?: string;
		timestamp?: Date;
	};
	analysis?: ImageDamageAnalysis;
}

export interface ImageDamageAnalysis {
	confidence: number; // 0-100
	detectedDamages: DetectedDamage[];
	vehicleParts: VehiclePartAnalysis[];
	overallCondition: number; // 0-100
	processingTime?: number; // ms
	aiModel?: string;
	version?: string;
}

export interface DetectedDamage {
	type: "scratch" | "dent" | "crack" | "missing" | "rust" | (string & {});
	location: BoundingBox;
	confidence: number; // 0-100
	severity: number; // 0-100
	affectedArea?: number; // px^2 or mm^2 depending on pipeline
	description?: string;
	repairComplexity?: "simple" | "moderate" | "complex";
}

export interface VehiclePartAnalysis {
	name: string;
	category:
		| "body"
		| "glass"
		| "tire"
		| "light"
		| "interior"
		| "engine"
		| "other";
	location?: BoundingBox;
	condition: number; // 0-100
	confidence: number; // 0-100
	damages: DetectedDamage[];
}

export interface BoundingBox {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface DamageAnalysisSummary {
	overallSeverity: number; // 0-100
	totalDamages: number;
	affectedParts: string[];
	repairTimeEstimate?: number; // hours
	drivingSafety: "safe" | "caution" | "unsafe";
	urgencyLevel?: number; // 0-100
	summary?: string;
	detailedReport?: string;
}

export interface CostBreakdown {
	category: "labor" | "materials" | "parts" | "diagnostics" | (string & {});
	description: string;
	cost: number;
	currency: string;
	confidence?: number; // 0-100
}

export interface RepairRecommendation {
	priority: number;
	action: string;
	description?: string;
	estimatedCost?: number;
	estimatedTime?: number; // hours
	difficulty?: "diy" | "professional" | "dealer";
	urgency?: "immediate" | "scheduled" | "optional";
	parts?: string[];
	tools?: string[];
	safetyNotes?: string[];
}

export interface VoiceCommand {
	id: string;
	userId: string;
	command: string;
	intent: string;
	entities: Array<Record<string, unknown>>;
	confidence: number; // 0-100
	response?: string;
	action?: VoiceAction;
	timestamp: Date;
	processingTime?: number; // ms
	language?: string;
	audioUrl?: string;
}

export interface VoiceAction {
	type: "search" | "navigate" | (string & {});
	target?: string;
	parameters?: Record<string, unknown>;
	executed?: boolean;
	result?: unknown;
}

export interface ChatConversation {
	id: string;
	userId: string;
	title: string;
	messages: ChatMessage[];
	context: ChatContext;
	status: "active" | "paused" | "completed" | "archived" | "error";
	createdAt: Date;
	updatedAt: Date;
}

export interface ChatContext {
	userPreferences: Record<string, unknown>;
	conversationHistory: unknown[];
	lastActivity: Date;
}

export interface ChatMessage {
	id: string;
	role: "user" | "assistant";
	content: string;
	timestamp: Date;
	metadata?: Record<string, unknown>;
}

export interface AISecurity {
	authentication: AuthenticationConfig;
	authorization: AuthorizationConfig;
	encryption: EncryptionConfig;
	audit: AuditConfig;
}

export interface AuthenticationConfig {
	required: boolean;
	methods: string[];
	tokenExpiry: number;
	refreshEnabled: boolean;
}

export interface AuthorizationConfig {
	enabled: boolean;
	roles: Role[];
	permissions: Permission[];
	policies: Policy[];
}

export interface Role {
	name: string;
	permissions: string[];
	description: string;
}

export interface Permission {
	name: string;
	resource: string;
	actions: string[];
	conditions?: string[];
}

export interface Policy {
	name: string;
	rules: PolicyRule[];
	effect: "allow" | "deny";
}

export interface EncryptionConfig {
	inTransit: boolean;
	atRest: boolean;
	algorithm: string;
	keyRotation: number;
}

export interface AuditConfig {
	enabled: boolean;
	events: string[];
	retention: number;
	storage: string;
}
