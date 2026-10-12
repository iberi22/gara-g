import type { GeographicLocation } from "./route";

export interface ListingMetadata {
	title: string;
	description: string;
	images: string[];
	videos?: string[];
	documents?: string[];
	specifications: Record<string, unknown>;
	condition: "new" | "used" | "refurbished" | "damaged";
	location?: GeographicLocation;
	shipping: ShippingInfo;
	warranty?: WarrantyInfo;
	certifications: string[];
	tags: string[];
}

export interface ShippingInfo {
	available: boolean;
	cost: number;
	estimatedDays: number;
	methods: ShippingMethod[];
	restrictions: string[];
	insurance: boolean;
}

export interface ShippingMethod {
	name: string;
	cost: number;
	estimatedDays: number;
	tracking: boolean;
	insurance: boolean;
}

export interface ListingVerification {
	verified: boolean;
	verifiedBy?: string;
	verificationMethod?: string;
	authenticity: AuthenticityCheck;
	compliance: ComplianceCheck;
	qualityScore: number;
}

export interface AuthenticityCheck {
	status: "pending" | "verified" | "failed" | "disputed";
	method: "manual" | "ai" | "third_party" | "blockchain";
	confidence: number;
	evidence: string[];
	checkedAt?: Date;
}

export interface ComplianceCheck {
	legal: boolean;
	safety: boolean;
	environmental: boolean;
	export: boolean;
	issues: string[];
	checkedAt: Date;
}

export interface ListingAnalytics {
	views: number;
	favorites: number;
	inquiries: number;
	offers: number;
	priceHistory: PricePoint[];
	engagement: EngagementMetrics;
	performance: MarketplacePerformanceMetrics;
}

export interface PricePoint {
	price: number;
	timestamp: Date;
	reason: "initial" | "update" | "offer" | "auction_bid";
}

export interface EngagementMetrics {
	clickThroughRate: number;
	conversionRate: number;
	averageViewTime: number;
	bounceRate: number;
	shareCount: number;
}

export interface MarketplacePerformanceMetrics {
	ranking: number;
	searchAppearances: number;
	searchClicks: number;
	categoryRanking: number;
	competitiveIndex: number;
}

export interface WarrantyInfo {
	duration: number; // months
	coverage: string[];
	terms: string;
	provider: string;
	validUntil: Date;
}

export interface MarketplaceListing {
	id: string;
	listingId: number;
	seller: string;
	nftContract: string;
	tokenId: number;
	price: number;
	currency: string;
	category: "vehicle" | "part" | "accessory" | "service" | "insurance";
	subcategory?: string;
	listingType: "fixed_price" | "auction" | "bundle" | "dutch_auction";
	status: "active" | "sold" | "cancelled" | "expired";
	metadata: ListingMetadata;
	verification: ListingVerification;
	analytics: ListingAnalytics;
	createdAt: Date;
	updatedAt: Date;
	expiresAt?: Date;
}

export interface MarketplaceSearch {
	query: string;
	filters: Record<string, unknown>;
	sortBy: string;
	sortOrder: "asc" | "desc";
	page: number;
	pageSize: number;
	results: MarketplaceListing[];
	totalResults: number;
	facets: Record<string, unknown>;
}

export interface AuctionListing {
	id: string;
	listingId: number;
	seller: string;
	nftContract: string;
	tokenId: number;
	startPrice: number;
	currentBid?: number;
	buyNowPrice?: number;
	currency: string;
	startTime: Date;
	endTime: Date;
	status: "active" | "ended" | "cancelled";
	bids: Bid[];
	highestBidder?: string;
	metadata: ListingMetadata;
	verification: ListingVerification;
	analytics: ListingAnalytics;
	createdAt: Date;
	updatedAt: Date;
}

export interface Bid {
	id: string;
	auctionId: string;
	bidder: string;
	amount: number;
	timestamp: Date;
	transactionHash: string;
}

export interface MarketplaceOffer {
	id: string;
	listingId: string;
	buyer: string;
	amount: number;
	currency: string;
	status: "pending" | "accepted" | "rejected" | "cancelled";
	createdAt: Date;
	updatedAt: Date;
	expiresAt?: Date;
}

export interface MarketplaceTransaction {
	id: string;
	listingId: string;
	buyer: string;
	seller: string;
	amount: number;
	currency: string;
	transactionHash: string;
	timestamp: Date;
	status: "pending" | "completed" | "failed" | "refunded";
	type: "sale" | "auction_win" | "offer_accepted";
}

export interface MarketplaceUser {
	id: string;
	userId: string;
	reputation: number;
	totalSales: number;
	totalPurchases: number;
	listings: string[]; // listing IDs
	reviews: string[]; // review IDs
	activity: UserActivity[];
	createdAt: Date;
	updatedAt: Date;
}

export interface UserActivity {
	id: string;
	userId: string;
	type:
		| "listing_created"
		| "bid_placed"
		| "offer_made"
		| "purchase"
		| "review_left";
	timestamp: Date;
	details: Record<string, unknown>;
}

export interface MarketplaceAnalytics {
	totalListings: number;
	activeListings: number;
	totalSales: number;
	totalVolume: number;
	averageSalePrice: number;
	topCategories: CategorySales[];
	salesTrends: SalesTrend[];
	userActivity: UserActivityMetrics;
}

export interface CategorySales {
	category: string;
	salesCount: number;
	volume: number;
}

export interface SalesTrend {
	date: Date;
	salesCount: number;
	volume: number;
}

export interface UserActivityMetrics {
	newUsers: number;
	activeUsers: number;
	returningUsers: number;
	averageSessionDuration: number;
}

export interface MarketplaceCollection {
	id: string;
	name: string;
	description: string;
	creator: string;
	nftContracts: string[];
	totalItems: number;
	floorPrice: number;
	volumeTraded: number;
	category: string;
	tags: string[];
	createdAt: Date;
	updatedAt: Date;
}
