import { z } from "zod";

/**
 * Full community post schema
 */
export const PostSchema = z.object({
	id: z.string().uuid(),
	authorId: z.string().min(1, "Author ID is required"),
	title: z.string().min(1, "Title is required").max(200),
	content: z.string().min(1, "Content is required").max(10000),
	tags: z.array(z.string()).default([]),
	likes: z.array(z.string()).default([]),
	isEdited: z.boolean().default(false),
	isDeleted: z.boolean().default(false),
	deletedBy: z.string().optional().nullable(),
	deletedAt: z.string().datetime().optional().nullable(),
	editedAt: z.string().datetime().optional().nullable(),
	createdAt: z.string().datetime(),
	updatedAt: z.string().datetime(),
});

/**
 * Schema for creating a new community post
 */
export const CreatePostSchema = z.object({
	authorId: z.string().min(1, "Author ID is required"),
	title: z.string().min(1, "Title is required").max(200, "Title too long"),
	content: z
		.string()
		.min(1, "Content is required")
		.max(10000, "Content too long"),
	tags: z.array(z.string()).max(10).optional().default([]),
});

/**
 * Schema for updating an existing community post
 */
export const UpdatePostSchema = z.object({
	title: z
		.string()
		.min(1, "Title cannot be empty")
		.max(200, "Title too long")
		.optional(),
	content: z
		.string()
		.min(1, "Content cannot be empty")
		.max(10000, "Content too long")
		.optional(),
	tags: z.array(z.string()).max(10).optional(),
});

/**
 * Response schema for paginated list
 */
export const PostListSchema = z.object({
	success: z.literal(true),
	count: z.number().nonnegative(),
	data: z.array(PostSchema),
});

/**
 * Response schema for single post
 */
export const PostResponseSchema = z.object({
	success: z.literal(true),
	data: PostSchema,
});

export type Post = z.infer<typeof PostSchema>;
export type CreatePost = z.infer<typeof CreatePostSchema>;
export type UpdatePost = z.infer<typeof UpdatePostSchema>;
