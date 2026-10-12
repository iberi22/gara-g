import type { GeographicLocation } from "./basic";
import type { PrivacySettings } from "./blockchain";
import type { SocialActivity } from "./user";

export interface IdentityProfile {
	displayName?: string;
	avatar?: string;
	bio?: string;
	website?: string;
	location?: GeographicLocation;
	socialLinks: SocialLinks;
	publicFields: string[];
	verificationLevel: VerificationLevel;
	badges: IdentityBadge[];
}

export interface SocialLinks {
	twitter?: string;
	linkedin?: string;
	github?: string;
	discord?: string;
	telegram?: string;
	instagram?: string;
	youtube?: string;
	tiktok?: string;
}

export interface VerificationLevel {
	level: "unverified" | "basic" | "enhanced" | "premium" | "enterprise";
	score: number; // 0-100
	requirements: VerificationRequirement[];
	completedAt?: Date;
	expiresAt?: Date;
}

export interface VerificationRequirement {
	type:
		| "email"
		| "phone"
		| "kyc"
		| "address"
		| "income"
		| "business"
		| "social"
		| "biometric";
	status: "pending" | "verified" | "failed" | "expired";
	verifiedAt?: Date;
	expiresAt?: Date;
	provider?: string;
	confidence: number;
}

export interface IdentityBadge {
	id: string;
	type: "verification" | "achievement" | "reputation" | "skill" | "community";
	name: string;
	description: string;
	icon: string;
	issuer: string;
	issuedAt: Date;
	expiresAt?: Date;
	metadata: Record<string, unknown>;
	rarity: "common" | "uncommon" | "rare" | "epic" | "legendary";
	transferable: boolean;
}

export interface VerifiableCredential {
	id: string;
	type: string[];
	issuer: CredentialIssuer;
	issuanceDate: Date;
	expirationDate?: Date;
	credentialSubject: CredentialSubject;
	proof: CryptographicProof;
	status: CredentialStatus;
	metadata: CredentialMetadata;
}

export interface CredentialIssuer {
	id: string;
	name: string;
	type: "government" | "institution" | "organization" | "dao" | "individual";
	did: string;
	publicKey: string;
	reputation: number;
	verified: boolean;
}

export interface CredentialSubject {
	id: string;
	type: string;
	claims: Record<string, unknown>;
	evidence: Evidence[];
	constraints?: CredentialConstraints;
}

export interface Evidence {
	id: string;
	type: string;
	verifier: string;
	evidenceDocument: string;
	subjectPresence: "physical" | "digital" | "remote";
	documentPresence: "physical" | "digital";
}

export interface CredentialConstraints {
	validFrom?: Date;
	validUntil?: Date;
	usageLimit?: number;
	usageCount?: number;
	geographicScope?: string[];
	purposeLimitation?: string[];
}

export interface CryptographicProof {
	type: string;
	created: Date;
	verificationMethod: string;
	proofPurpose: string;
	signature: string;
	challenge?: string;
	domain?: string;
}

export interface CredentialStatus {
	id: string;
	type: string;
	status: "valid" | "revoked" | "suspended" | "expired";
	statusListIndex?: number;
	statusListCredential?: string;
}

export interface CredentialMetadata {
	schema: string;
	context: string[];
	refreshService?: RefreshService;
	termsOfUse?: TermsOfUse[];
	evidence?: Evidence[];
}

export interface RefreshService {
	id: string;
	type: string;
	refreshToken: string;
}

export interface TermsOfUse {
	type: string;
	policy: string;
	prohibition?: string[];
}

export interface ReputationScore {
	overall: number; // 0-1000
	categories: ReputationCategory[];
	history: ReputationHistory[];
	factors: ReputationFactor[];
	lastCalculated: Date;
	trend: "increasing" | "decreasing" | "stable";
	percentile: number; // 0-100 (compared to all users)
}

export interface ReputationCategory {
	category: "trading" | "technical" | "social" | "governance" | "contribution";
	score: number;
	weight: number;
	evidence: ReputationEvidence[];
	lastUpdated: Date;
}

export interface ReputationEvidence {
	type:
		| "transaction"
		| "review"
		| "endorsement"
		| "achievement"
		| "participation";
	source: string;
	value: number;
	weight: number;
	timestamp: Date;
	verified: boolean;
}

export interface ReputationHistory {
	date: Date;
	score: number;
	change: number;
	reason: string;
	category?: string;
}

export interface ReputationFactor {
	factor: string;
	impact: number; // -100 to +100
	description: string;
	evidence: string[];
}

export interface Attestation {
	id: string;
	attester: string; // DID of attester
	subject: string; // DID of subject
	claim: AttestationClaim;
	evidence: AttestationEvidence;
	signature: string;
	timestamp: Date;
	expiresAt?: Date;
	revoked: boolean;
	revokedAt?: Date;
	revokedReason?: string;
}

export interface AttestationClaim {
	type: string;
	statement: string;
	confidence: number; // 0-1
	context: Record<string, unknown>;
}

export interface AttestationEvidence {
	type: "direct" | "indirect" | "hearsay";
	sources: string[];
	methodology: string;
	reliability: number; // 0-1
}

export interface SocialProof {
	connections: SocialConnection[];
	endorsements: Endorsement[];
	communities: CommunityMembership[];
	activities: SocialActivity[];
	influence: InfluenceMetrics;
}

export interface SocialConnection {
	connectedTo: string; // DID
	connectionType: "mutual" | "follower" | "following" | "colleague" | "friend";
	strength: number; // 0-1
	establishedAt: Date;
	interactions: number;
	lastInteraction: Date;
	verified: boolean;
}

export interface Endorsement {
	id: string;
	endorser: string; // DID
	skill: string;
	level: number; // 1-5
	comment?: string;
	timestamp: Date;
	verified: boolean;
}

export interface CommunityMembership {
	communityId: string;
	communityName: string;
	role: "member" | "moderator" | "admin" | "founder";
	joinedAt: Date;
	reputation: number;
	contributions: number;
	verified: boolean;
}

export interface InfluenceMetrics {
	followers: number;
	following: number;
	engagementRate: number;
	reachScore: number;
	authorityScore: number;
	trustScore: number;
}

export interface IdentityVerificationRequest {
	id: string;
	requester: string;
	subject: string;
	purpose: string;
	requestedCredentials: string[];
	requestedAttestations: string[];
	minimumReputation?: number;
	expiresAt: Date;
	status: "pending" | "approved" | "denied" | "expired";
	response?: VerificationResponse;
	createdAt: Date;
}

export interface VerificationResponse {
	approved: boolean;
	sharedCredentials: string[];
	sharedAttestations: string[];
	conditions?: string[];
	expiresAt?: Date;
	respondedAt: Date;
}

export interface ReputationChallenge {
	id: string;
	challenger: string;
	subject: string;
	category: string;
	claim: string;
	evidence: string[];
	status: "open" | "under_review" | "resolved" | "dismissed";
	resolution?: ChallengeResolution;
	resolvedAt?: Date;
}

export interface ChallengeResolution {
	outcome: "upheld" | "dismissed" | "partial";
	adjustments: ReputationAdjustment[];
	reasoning: string;
	resolver: string;
	appealable: boolean;
	appealDeadline?: Date;
}

export interface ReputationAdjustment {
	category: string;
	change: number;
	reason: string;
	evidence: string[];
}

export interface IdentityRecovery {
	id: string;
	identity: string; // DID
	recoveryMethod: "social" | "guardian" | "backup" | "biometric" | "legal";
	guardians?: string[]; // DIDs of guardians
	threshold?: number; // Number of guardians required
	backupData?: EncryptedBackup;
	status: "active" | "initiated" | "completed" | "failed";
	initiatedAt?: Date;
	completedAt?: Date;
}

export interface EncryptedBackup {
	encryptedData: string;
	encryptionMethod: string;
	keyDerivation: string;
	checksum: string;
	createdAt: Date;
}

export interface IdentityAnalytics {
	identityId: string;
	timeRange: {
		start: Date;
		end: Date;
	};
	metrics: IdentityMetrics;
	interactions: IdentityInteraction[];
	verificationActivity: VerificationActivity[];
	reputationChanges: ReputationChange[];
	privacyEvents: PrivacyEvent[];
	generatedAt: Date;
}

export interface IdentityMetrics {
	verificationRequests: number;
	credentialsIssued: number;
	credentialsVerified: number;
	attestationsReceived: number;
	attestationsGiven: number;
	reputationGrowth: number;
	socialConnections: number;
	privacyScore: number;
}

export interface IdentityInteraction {
	type: "verification" | "attestation" | "connection" | "challenge";
	counterparty: string;
	timestamp: Date;
	outcome: "successful" | "failed" | "pending";
	details: Record<string, unknown>;
}

export interface VerificationActivity {
	verifierId: string;
	count: number;
	successful: number;
	failed: number;
	pending: number;
}

export interface ReputationChange {
	timestamp: Date;
	change: number;
	reason: string;
	source: string;
}

export interface PrivacyEvent {
	timestamp: Date;
	type: "data_access" | "consent_change" | "policy_update";
	description: string;
	details: Record<string, unknown>;
}

export interface EnhancedDecentralizedIdentity {
	id: string;
	did: string;
	identityProfile: IdentityProfile;
	verifiableCredentials: VerifiableCredential[];
	reputationScore: ReputationScore;
	attestations: Attestation[];
	socialProof: SocialProof;
	privacySettings: PrivacySettings;
	recoveryMethods: IdentityRecovery[];
	analytics: IdentityAnalytics;
	createdAt: Date;
	updatedAt: Date;
}

export interface DisputeResolution {
	id: string;
	type: "reputation" | "identity" | "marketplace";
	status: "open" | "in_progress" | "resolved" | "closed";
	parties: string[]; // DIDs or user IDs
	description: string;
	evidence: string[];
	resolution?: string;
	resolvedBy?: string;
	resolvedAt?: Date;
	createdAt: Date;
	updatedAt: Date;
}

export interface ConsentRecord {
	id: string;
	userId: string;
	purpose: string;
	granted: boolean;
	timestamp: Date;
}

export interface IdentityVerification {
	id: string;
	identityId: string;
	verifier: string;
	status: string;
	verifiedAt?: Date;
}

export interface PolicyRule {
	id: string;
	name: string;
	description?: string;
	effect: "allow" | "deny";
	action: string[];
	resource: string[];
	condition?: Record<string, unknown>;
}
