// Extended Decentralized Identity and Reputation System Types for Task 4

// Enhanced Decentralized Identity Interface
export interface EnhancedDecentralizedIdentity {
	id: string;
	did: string; // Decentralized Identifier (W3C DID standard)
	address: string; // Blockchain address
	userId: string; // Internal user ID
	profile: IdentityProfile;
	credentials: VerifiableCredential[];
	reputation: ReputationScore;
	privacySettings: PrivacySettings;
	consentRecords: ConsentRecord[];
	createdAt: Date;
	updatedAt: Date;
	status: "active" | "inactive" | "suspended" | "revoked";
}

export interface IdentityProfile {
	displayName: string;
	bio: string;
	avatarUrl?: string;
	coverUrl?: string;
	location?: string;
	website?: string;
	socialLinks: SocialLink[];
	verified: boolean;
	verificationLevel: "basic" | "enhanced" | "premium" | "platinum";
	lastVerifiedAt?: Date;
}

export interface SocialLink {
	platform: string;
	url: string;
	verified: boolean;
}

export interface VerifiableCredential {
	id: string;
	type: string[];
	issuer: string;
	issuanceDate: Date;
	expirationDate?: Date;
	credentialSubject: CredentialSubject;
	proof: CredentialProof;
	status: "active" | "expired" | "revoked" | "suspended";
}

export interface CredentialSubject {
	id: string;
	[key: string]:
		| string
		| number
		| boolean
		| object
		| Array<unknown>
		| null
		| undefined; // Flexible structure for different credential types
}

export interface CredentialProof {
	type: string;
	created: Date;
	proofPurpose: string;
	verificationMethod: string;
	jws: string;
}

export interface ReputationScore {
	overall: number; // 0-100
	trust: number; // 0-100
	activity: number; // 0-100
	quality: number; // 0-100
	level: "bronze" | "silver" | "gold" | "platinum" | "diamond";
	badges: Badge[];
	recentActivity: ReputationActivity[];
	lastUpdated: Date;
}

export interface Badge {
	id: string;
	name: string;
	description: string;
	iconUrl: string;
	earnedAt: Date;
	expiresAt?: Date;
}

export interface ReputationActivity {
	id: string;
	type:
		| "verification"
		| "attestation"
		| "connection"
		| "transaction"
		| "review"
		| "achievement";
	points: number;
	description: string;
	timestamp: Date;
	relatedEntity?: string;
}

export interface PrivacySettings {
	visibility: "public" | "connections" | "private";
	dataSharing: DataSharingPreferences;
	consentManagement: ConsentManagementSettings;
	recovery: IdentityRecoveryOptions;
}

export interface DataSharingPreferences {
	profileInfo: SharingLevel;
	credentials: SharingLevel;
	reputation: SharingLevel;
	activity: SharingLevel;
	customFields: CustomSharingSetting[];
}

export type SharingLevel = "full" | "limited" | "score_only" | "private";

export interface CustomSharingSetting {
	field: string;
	level: SharingLevel;
}

export interface ConsentManagementSettings {
	defaultConsent:
		| "consent_required"
		| "consent_given"
		| "verified_only"
		| "private";
	dataRetention: DataRetentionPolicy;
	thirdPartySharing: boolean;
	analyticsSharing: boolean;
}

export interface DataRetentionPolicy {
	profileData: number; // days
	activityData: number; // days
	credentialData: number; // days
	consentRecords: number; // days
}

export interface IdentityRecoveryOptions {
	recoveryMethods: RecoveryMethod[];
	backupContacts: string[];
	securityQuestions: SecurityQuestion[];
}

export interface RecoveryMethod {
	type: "email" | "phone" | "social" | "hardware" | "paper_key";
	value: string;
	verified: boolean;
	primary: boolean;
}

export interface SecurityQuestion {
	question: string;
	answerHash: string;
}

export interface ConsentRecord {
	id: string;
	purpose: string;
	dataTypes: string[];
	recipient: string;
	grantedAt: Date;
	expiresAt?: Date;
	status: "active" | "revoked" | "expired";
	proof?: string;
}

// Reputation System Interfaces
export interface ReputationMetrics {
	totalInteractions: number;
	positiveInteractions: number;
	negativeInteractions: number;
	neutralInteractions: number;
	responseRate: number; // 0-1
	completionRate: number; // 0-1
	disputeRate: number; // 0-1
	averageRating: number; // 0-5
	trustScore: number; // 0-100
}

export interface ReputationChange {
	id: string;
	userId: string;
	sourceUserId: string;
	type:
		| "endorsement"
		| "achievement"
		| "review"
		| "verification"
		| "privacy"
		| "dispute_resolution"
		| "governance_participation"
		| "content_creation"
		| "community_contribution";
	points: number;
	description: string;
	evidence?: string;
	timestamp: Date;
	status: "pending" | "approved" | "rejected" | "disputed";
}

export interface DisputeResolution {
	id: string;
	reporter: string;
	reportedUser: string;
	reason: string;
	evidence: DisputeEvidence[];
	status:
		| "reported"
		| "under_review"
		| "escalated"
		| "resolved"
		| "dismissed"
		| "failed";
	resolution?: string;
	remedies: string[];
	appealable: boolean;
	appealDeadline?: Date;
	createdAt: Date;
	resolvedAt?: Date;
}

export interface DisputeEvidence {
	id: string;
	type: "document" | "testimony" | "technical" | "expert" | "other";
	description: string;
	url?: string;
	submittedAt: Date;
}

// Governance and Voting Interfaces
export interface GovernanceVoting {
	activeProposals: VotingProposal[];
	votingHistory: VotingRecord[];
	participationRate: number; // 0-1
	quorumThreshold: number; // 0-1
}

export interface VotingProposal {
	id: string;
	title: string;
	description: string;
	proposer: string;
	category: string;
	options: VotingOption[];
	startDate: Date;
	endDate: Date;
	quorumRequired: number; // 0-1
	status: "active" | "passed" | "failed" | "cancelled";
	totalVotes?: number;
	results?: VotingResult[];
}

export interface VotingOption {
	id: string;
	text: string;
	votes: number;
	percentage: number;
}

export interface VotingResult {
	optionId: string;
	votes: number;
	percentage: number;
}

export interface VotingRecord {
	proposalId: string;
	voter: string;
	option: string;
	votingPower: number;
	timestamp: Date;
	anonymous: boolean;
}

// Identity Verification Interfaces
export interface IdentityVerification {
	id: string;
	userId: string;
	method:
		| "government_id"
		| "biometric"
		| "social"
		| "credit"
		| "employment"
		| "education"
		| "blockchain"
		| "third_party"
		| "manual";
	status: "pending" | "verified" | "failed" | "disputed" | "expired";
	evidence: VerificationEvidence[];
	verifiedBy?: string;
	verifiedAt?: Date;
	expiresAt?: Date;
	confidence: number; // 0-1
	notes?: string;
}

export interface VerificationEvidence {
	type:
		| "document"
		| "biometric"
		| "digital_signature"
		| "third_party_attestation"
		| "blockchain_proof"
		| "manual_review";
	data: string; // URL or reference to evidence
	timestamp: Date;
}

// Privacy and Compliance Interfaces
export interface PrivacyEvent {
	id: string;
	userId: string;
	type:
		| "consent_given"
		| "consent_withdrawn"
		| "data_shared"
		| "data_accessed"
		| "data_deleted"
		| "privacy_policy_updated"
		| "data_breach"
		| "access_request"
		| "deletion_request";
	details: string;
	timestamp: Date;
	relatedParty?: string;
}

export interface ComplianceCheck {
	id: string;
	userId: string;
	regulation: "gdpr" | "ccpa" | "hipaa" | "sox" | "other";
	status: "compliant" | "non_compliant" | "under_review" | "pending";
	lastChecked: Date;
	issues: ComplianceIssue[];
	remediationPlan?: string;
}

export interface ComplianceIssue {
	id: string;
	type: string;
	description: string;
	severity: "low" | "medium" | "high" | "critical";
	detectedAt: Date;
	resolvedAt?: Date;
	resolutionNotes?: string;
}

// Identity Analytics Interfaces
export interface IdentityMetrics {
	userId: string;
	totalCredentials: number;
	verifiedCredentials: number;
	reputationScore: number;
	trustLevel: "low" | "medium" | "high" | "enhanced" | "premium";
	activityScore: number;
	connectionsCount: number;
	transactionsCount: number;
	disputeCount: number;
	privacyCompliance: boolean;
	lastActivity: Date;
	engagementMetrics: EngagementMetrics;
	securityMetrics: SecurityMetrics;
}

export interface EngagementMetrics {
	dailyActive: number;
	weeklyActive: number;
	monthlyActive: number;
	interactionRate: number; // 0-1
	responseTime: number; // seconds
}

export interface SecurityMetrics {
	authenticationMethods: number;
	recoveryOptions: number;
	breachIncidents: number;
	suspiciousActivity: number;
	securityScore: number; // 0-100
}

// Identity Interactions
export interface IdentityInteraction {
	id: string;
	fromUserId: string;
	toUserId: string;
	type:
		| "verification"
		| "attestation"
		| "connection"
		| "transaction"
		| "review"
		| "dispute"
		| "endorsement"
		| "recommendation"
		| "report";
	details: string;
	timestamp: Date;
	status: "pending" | "completed" | "failed" | "disputed";
	evidence?: string;
}

// DID Document Structure
export interface DIDDocument {
	"@context": string | string[];
	id: string;
	alsoKnownAs?: string[];
	controller?: string | string[];
	verificationMethod?: VerificationMethod[];
	authentication?: (string | VerificationMethod)[];
	assertionMethod?: (string | VerificationMethod)[];
	keyAgreement?: (string | VerificationMethod)[];
	capabilityInvocation?: (string | VerificationMethod)[];
	capabilityDelegation?: (string | VerificationMethod)[];
	service?: Service[];
}

export interface VerificationMethod {
	id: string;
	type: string;
	controller: string;
	publicKeyBase58?: string;
	publicKeyJwk?: { [key: string]: string | number | boolean }; // JSON Web Key structure
}

export interface Service {
	id: string;
	type: string;
	serviceEndpoint: string;
}
