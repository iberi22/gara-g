// Re-export all types from types folder using namespaces to prevent collisions

export * from "./compliance-types";
// Route optimization config
export * from "./config/maps.config";
export * from "./enterprise-types";
export * from "./schemas/ai";
export * from "./schemas/depin";
export * from "./schemas/enterprise";
export * from "./schemas/governance";
export * from "./schemas/community";
export * from "./schemas/staking";
export * from "./schemas/vesting";
// Re-export services
export * from "./services/google-routes";
export * from "./types/depin";
export * from "./types/routes.types";
export type { VehicleHistoryData } from "./types";
export * as AiIntegrationTypes from "./types/aiIntegration";
// Specialized types from refactoring
export * as AnalyticsTypes from "./types/analytics";
export * as AutonomousVehicleTypes from "./types/autonomousVehicle";
export * as BasicTypes from "./types/basic";
export * as BillingTypes from "./types/billing";
export * as BlockchainTypes from "./types/blockchain";
export * as ComplianceTypes from "./types/compliance";
export * as DigitalTwinTypes from "./types/digitalTwin";
// Enterprise types for B2B fleet management
export * as EnterpriseTypes from "./types/enterprise";
// Direct named type exports used by the app
export type { ForumCategory, ForumTopic } from "./types/forum";
export * as ForumTypes from "./types/forum";
export * as GamificationTypes from "./types/gamification";
export type { Route } from "./types/gps";
export * as GpsTypes from "./types/gps";
export * as IdentityTypes from "./types/identity";
export * as IotTypes from "./types/iot";
export * as MarketplaceTypes from "./types/marketplace";
export * as MlPipelineTypes from "./types/mlPipeline";
export * as ModelTypes from "./types/model";
export * as OrganizationTypes from "./types/organization";
export * as PartsTypes from "./types/parts";
export * as PredictionTypes from "./types/prediction";
export * as RouteTypes from "./types/route";
// Route optimization types for Phase 3B
export * as RouteOptimizationTypes from "./types/routes.types";
// Temporary namespace for types that are in src/types/temp-missing.ts
export * as TempMissingTypes from "./types/temp-missing";
export * as TrackingTypes from "./types/tracking";
export * as TrainingTypes from "./types/training";
export type { UserProfile } from "./types/user";
export * as UserTypes from "./types/user";
// Export vehicle types directly from vehicle.ts
export type {
	MaintenanceSchedule,
	Vehicle,
	VehicleHealthRecord,
} from "./types/vehicle";
export * as VehicleTypes from "./types/vehicle";
export type { GeminiVINResponse } from "./types/vin";
export * as VinTypes from "./types/vin";

// Re-export utilities
export * from "./utils";

