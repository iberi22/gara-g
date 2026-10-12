export interface Organization {
	id: string;
	name: string;
	legalName?: string;
	type: "company" | "nonprofit" | "government" | "startup" | (string & {});
	website?: string;
	contactEmail?: string;
	phone?: string;
	address?: string;
	branding?: {
		logoUrl?: string;
		primaryColor?: string;
		secondaryColor?: string;
	};
	settings?: Record<string, unknown>;
	members?: OrganizationMember[];
	createdAt: Date;
	updatedAt: Date;
}

export interface OrganizationMember {
	userId: string;
	role: "owner" | "admin" | "member" | "viewer" | (string & {});
	joinedAt: Date;
	status: "active" | "invited" | "suspended";
}

export interface BusinessHours {
	monday: DayHours;
	tuesday: DayHours;
	wednesday: DayHours;
	thursday: DayHours;
	friday: DayHours;
	saturday: DayHours;
	sunday: DayHours;
}

export interface DayHours {
	open: string; // HH:MM format
	close: string; // HH:MM format
	closed: boolean;
}

export interface ServiceAddress {
	street: string;
	city: string;
	state: string;
	zipCode: string;
	country: string;
}
