import type { GeographicLocation } from "./basic";
import type { BusinessHours, ServiceAddress } from "./organization";
import type { VehicleCompatibility } from "./vehicle";

export interface VehiclePart {
	id: string;
	name: string;
	description: string;
	category: string;
	subcategory?: string;
	partNumber: string;
	oem: boolean;
	brand: string;
	compatibility: VehicleCompatibility[];
	specifications: Record<string, unknown>;
	priceRange: {
		min: number;
		max: number;
		currency: string;
	};
	availability: "in_stock" | "limited" | "out_of_stock" | "discontinued";
	images: string[];
	tags: string[];
	reviews: PartReview[];
	averageRating: number;
	totalReviews: number;
	createdAt: Date;
	updatedAt: Date;
}

export interface ServiceProvider {
	id: string;
	name: string;
	description: string;
	type: "dealership" | "independent" | "chain" | "mobile";
	services: string[];
	location: GeographicLocation;
	address: ServiceAddress;
	contact: {
		phone: string;
		email: string;
		website?: string;
	};
	hours: BusinessHours;
	certifications: string[];
	specialties: string[];
	rating: number;
	totalReviews: number;
	reviews: ServiceReview[];
	pricing: ServicePricing[];
	createdAt: Date;
	updatedAt: Date;
}

export interface PartReview {
	id: string;
	partId: string;
	userId: string;
	rating: number; // 1-5
	title: string;
	comment: string;
	verified: boolean;
	helpful: number;
	images?: string[];
	createdAt: Date;
}

export interface ServiceReview {
	id: string;
	serviceProviderId: string;
	userId: string;
	serviceType: string;
	rating: number; // 1-5
	title: string;
	comment: string;
	pros?: string[];
	cons?: string[];
	wouldRecommend: boolean;
	verified: boolean;
	helpful: number;
	images?: string[];
	createdAt: Date;
}

export interface ServicePricing {
	serviceType: string;
	description: string;
	priceRange: {
		min: number;
		max: number;
		currency: string;
	};
	duration: number; // minutes
}
