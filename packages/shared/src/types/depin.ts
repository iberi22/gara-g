export interface MeshLocation {
	lat: number;
	lng: number;
}

export type MeshStatus = "online" | "offline" | "relay";

export interface MeshPeer {
	peerId: string;
	location: MeshLocation;
	status: MeshStatus;
	lastSeen: number;
	signalStrength: number;
	routeTable: Map<string, string[]>; // destination -> hops
}

export interface MeshMessage {
	id: string;
	senderId: string;
	recipientId: string;
	content: string; // Encrypted
	timestamp: number;
	ttl: number;
	path: string[];
}

export interface RouteRequest {
	id: string;
	originatorId: string;
	targetId: string;
	sequenceNumber: number;
	hopCount: number;
}

export interface RouteReply {
	id: string;
	originatorId: string;
	targetId: string;
	hopCount: number;
	lifetime: number;
}
