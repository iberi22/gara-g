export interface ForumCategory {
	id: string;
	name: string;
	description?: string;
	icon?: string; // e.g., emoji or icon key
	color?: string; // hex color
	moderators: string[]; // user IDs
	topicCount: number;
	postCount: number;
	isActive: boolean;
	createdAt: Date;
	updatedAt: Date;
}

export interface ForumTopic {
	id: string;
	categoryId: string;
	authorId: string;
	title: string;
	description?: string;
	tags?: string[];
	isPinned: boolean;
	isLocked: boolean;
	viewCount: number;
	replyCount: number;
	lastReplyAt: Date;
	lastReplyBy: string;
	createdAt: Date;
	updatedAt: Date;
}

export interface ForumPost {
	id: string;
	topicId: string;
	authorId: string;
	content: string;
	likes: string[]; // user IDs who liked
	isEdited: boolean;
	isDeleted: boolean;
	deletedBy?: string;
	deletedAt?: Date;
	editedAt?: Date;
	createdAt: Date;
	updatedAt: Date;
}
