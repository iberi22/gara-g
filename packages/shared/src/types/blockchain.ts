import type {
	SecurityAlert,
	SecurityAudit,
	SecurityIssue,
	SecurityReport,
} from "./basic";

export interface NFTMetadata {
	name: string;
	description: string;
	image: string;
	external_url?: string;
	animation_url?: string;
	background_color?: string;
	attributes: NFTAttribute[];
}

export interface NFTAttribute {
	trait_type: string;
	value: string | number;
	display_type?: "number" | "boost_number" | "boost_percentage" | "date";
	max_value?: number;
}

export interface OwnershipHistory {
	id: string;
	from: string;
	to: string;
	transactionHash: string;
	blockNumber: number;
	timestamp: Date;
	price?: number;
	currency?: string;
	transferType: "mint" | "sale" | "transfer" | "burn";
}

export interface Currency {
	name: string;
	symbol: string;
	decimals: number;
	icon?: string;
}

export interface GasPrice {
	slow: number;
	standard: number;
	fast: number;
	unit: "gwei" | "wei";
	lastUpdated: Date;
}

export interface BlockchainFeature {
	name: string;
	enabled: boolean;
	version: string;
	description: string;
}

export interface DeployedContract {
	id: string;
	name: string;
	address: string;
	abi: Record<string, unknown>[];
	bytecode: string;
	version: string;
	deployedAt: Date;
	deployedBy: string;
	verified: boolean;
	status: "active" | "deprecated" | "paused";
}

export interface ContractConstructor {
	parameters: ContractParameter[];
	payable: boolean;
	gasEstimate: number;
}

export interface ContractFunction {
	name: string;
	type: "function" | "constructor" | "fallback" | "receive";
	visibility: "public" | "private" | "internal" | "external";
	stateMutability: "pure" | "view" | "nonpayable" | "payable";
	parameters: ContractParameter[];
	returns: ContractParameter[];
	modifiers: string[];
	gasEstimate: number;
	description: string;
}

export interface ContractEvent {
	name: string;
	parameters: ContractParameter[];
	anonymous: boolean;
	description: string;
}

export interface ContractModifier {
	name: string;
	parameters: ContractParameter[];
	description: string;
}

export interface ContractVariable {
	name: string;
	type: string;
	visibility: "public" | "private" | "internal";
	constant: boolean;
	immutable: boolean;
	value?: unknown;
	description: string;
}

export interface ContractParameter {
	name: string;
	type: string;
	indexed?: boolean;
	description: string;
}

export interface GasEstimate {
	deployment: number;
	functions: Record<string, number>;
	total: number;
	optimized: boolean;
}

export interface DeploymentConfig {
	network: string;
	gasLimit: number;
	gasPrice: number;
	value: number;
	confirmations: number;
	timeout: number;
	verify: boolean;
}

export interface Vote {
	id: string;
	voter: string;
	choice: "for" | "against" | "abstain";
	power: number;
	reason?: string;
	timestamp: Date;
	transactionHash: string;
}

export interface VotingPower {
	total: number;
	for: number;
	against: number;
	abstain: number;
	quorum: number;
	threshold: number;
}

export interface ProposalTimeline {
	created: Date;
	votingStart: Date;
	votingEnd: Date;
	queuedAt?: Date;
	executedAt?: Date;
	cancelledAt?: Date;
}

export interface ProposalExecution {
	targets: string[];
	values: number[];
	signatures: string[];
	calldatas: string[];
	eta?: Date;
}

export interface WalletBalance {
	currency: string;
	balance: number;
	usdValue: number;
	lastUpdated: Date;
}

export interface TokenBalance {
	contractAddress: string;
	symbol: string;
	name: string;
	decimals: number;
	balance: number;
	usdValue: number;
	price: number;
	change24h: number;
}

export interface NFTBalance {
	contractAddress: string;
	tokenId: number;
	name: string;
	description: string;
	image: string;
	collection: string;
	floorPrice?: number;
	lastSale?: number;
}

export interface WalletSecurity {
	encrypted: boolean;
	backupCreated: boolean;
	twoFactorEnabled: boolean;
	biometricEnabled: boolean;
	lastSecurityCheck: Date;
	riskScore: number;
	alerts: SecurityAlert[];
}

export interface WalletSettings {
	defaultGasPrice: number;
	autoApprove: boolean;
	notifications: NotificationSettings;
	privacy: PrivacySettings;
	backup: BackupSettings;
}

export interface NotificationSettings {
	transactions: boolean;
	priceAlerts: boolean;
	securityAlerts: boolean;
	marketingEmails: boolean;
}

export interface PrivacySettings {
	id: string;
	userId: string;
	settings: unknown;
	updatedAt: Date;
}

export interface BackupSettings {
	autoBackup: boolean;
	backupFrequency: "daily" | "weekly" | "monthly";
	cloudBackup: boolean;
	encryptBackup: boolean;
}

export interface BlockchainMetrics {
	totalTransactions: number;
	totalValue: number;
	activeAddresses: number;
	gasUsed: number;
	averageGasPrice: number;
	blockTime: number;
	networkUtilization: number;
}

export interface TransactionAnalytics {
	volume: number;
	count: number;
	averageValue: number;
	averageGasFee: number;
	successRate: number;
	topAddresses: AddressActivity[];
	hourlyDistribution: HourlyData[];
}

export interface AddressActivity {
	address: string;
	transactionCount: number;
	volume: number;
	type: "user" | "contract" | "exchange" | "bridge";
}

export interface HourlyData {
	hour: number;
	transactions: number;
	volume: number;
	gasUsed: number;
}

export interface ContractAnalytics {
	totalContracts: number;
	activeContracts: number;
	topContracts: ContractActivity[];
	gasConsumption: ContractGasUsage[];
	deployments: ContractDeployment[];
}

export interface ContractActivity {
	address: string;
	name: string;
	type: string;
	transactionCount: number;
	gasUsed: number;
	uniqueUsers: number;
}

export interface ContractGasUsage {
	address: string;
	name: string;
	totalGas: number;
	averageGas: number;
	efficiency: number;
}

export interface ContractDeployment {
	address: string;
	deployer: string;
	timestamp: Date;
	gasUsed: number;
	verified: boolean;
}

export interface TokenAnalytics {
	totalTokens: number;
	totalSupply: number;
	totalMarketCap: number;
	topTokens: TokenActivity[];
	transfers: TokenTransfer[];
	holders: TokenHolder[];
}

export interface TokenActivity {
	address: string;
	symbol: string;
	name: string;
	transfers: number;
	volume: number;
	holders: number;
	marketCap: number;
}

export interface TokenTransfer {
	token: string;
	from: string;
	to: string;
	amount: number;
	timestamp: Date;
	transactionHash: string;
}

export interface TokenHolder {
	address: string;
	balance: number;
	percentage: number;
	type: "user" | "contract" | "exchange";
}

export interface DeFiAnalytics {
	totalValueLocked: number;
	protocols: ProtocolActivity[];
	yields: YieldData[];
	liquidations: LiquidationData[];
}

export interface ProtocolActivity {
	protocol: string;
	tvl: number;
	volume: number;
	users: number;
	transactions: number;
}

export interface YieldData {
	protocol: string;
	token: string;
	apy: number;
	tvl: number;
	risk: string;
}

export interface LiquidationData {
	protocol: string;
	amount: number;
	collateral: string;
	timestamp: Date;
}

export interface GovernanceAnalytics {
	totalProposals: number;
	activeProposals: number;
	participationRate: number;
	topVoters: VoterActivity[];
	proposalOutcomes: ProposalOutcome[];
}

export interface VoterActivity {
	address: string;
	votes: number;
	power: number;
	participation: number;
}

export interface ProposalOutcome {
	id: string;
	title: string;
	outcome: "passed" | "failed" | "pending";
	votes: number;
	participation: number;
}

export interface GovernanceVoting {
	proposalId: string;
	voterId: string;
	vote: "for" | "against" | "abstain";
	timestamp: Date;
	votingPowerUsed: number;
	transactionHash: string;
}

export interface BlockchainNetwork {
	id: string;
	name: string;
	type: "mainnet" | "testnet" | "devnet";
	chainId: number;
	rpcUrl: string;
	explorerUrl: string;
	nativeCurrency: Currency;
	blockTime: number; // seconds
	gasPrice: GasPrice;
	status: "active" | "inactive" | "maintenance";
	features: BlockchainFeature[];
	contracts: DeployedContract[];
	createdAt: Date;
	updatedAt: Date;
}

export interface SmartContract {
	id: string;
	name: string;
	description: string;
	type:
		| "vehicle_ownership"
		| "maintenance_record"
		| "marketplace"
		| "insurance"
		| "warranty"
		| "identity"
		| "reputation"
		| "payment"
		| "governance";
	version: string;
	sourceCode: string;
	abi: Record<string, unknown>[];
	bytecode: string;
	constructor: ContractConstructor;
	functions: ContractFunction[];
	events: ContractEvent[];
	modifiers: ContractModifier[];
	variables: ContractVariable[];
	dependencies: string[];
	security: SecurityAudit;
	gas: GasEstimate;
	deployment: DeploymentConfig;
	status: "draft" | "compiled" | "deployed" | "verified" | "deprecated";
	createdAt: Date;
	updatedAt: Date;
}

export interface VehicleNFT {
	id: string;
	tokenId: number;
	contractAddress: string;
	vehicleId: string;
	vin: string;
	owner: string;
	metadata: NFTMetadata;
	attributes: NFTAttribute[];
	history: OwnershipHistory[];
	status: "active" | "transferred" | "burned";
	createdAt: Date;
	updatedAt: Date;
}

export interface MaintenanceRecord {
	id: string;
	vehicleId: string;
	type: string;
	description: string;
	cost: number;
	date: Date;
	serviceProvider?: string;
}
