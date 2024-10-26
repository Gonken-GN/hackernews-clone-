import { insertCommentSchema } from "@/db/schema/comments";
import { insertPostSchema } from "@/db/schema/post";
import { z } from "zod";

export type SucessResponse<T = void> = {
  success: true;
  message: string;
} & (T extends void ? {} : { data: T });

export type ErrorResponse = {
  success: false;
  error: string;
  isFormError?: boolean;
};

export const loginSchema = z.object({
  username: z
    .string()
    .min(3)
    .max(31)
    .regex(/^[a-zA-Z0-9_]+$/),
  password: z.string().min(3).max(255),
});

export const createPostSchema = insertPostSchema
  .pick({
    title: true,
    url: true,
    content: true,
  })
  .refine((data) => data.url || data.content, {
    message: "URL or content is required",
    path: ["url", "content"],
  });

export const sorBySchema = z.enum(["points", "recent"]);
export const orderSchema = z.enum(["asc", "desc"]);

export const paginationSchema = z.object({
  limit: z.number({ coerce: true }).optional().default(10),
  page: z.number({ coerce: true }).optional().default(1),
  sortBy: sorBySchema.optional().default("points"),
  order: orderSchema.optional().default("desc"),
  author: z.optional(z.string()),
  site: z.string().optional(),
});

export const createCommentSchema = insertCommentSchema.pick({
  content: true,
});

export type Post = {
  id: number;
  title: string;
  url: string | null;
  content: string | null;
  points: number;
  createdAt: string;
  commentCount: number;
  author: {
    id: string;
    username: string;
  };
  isUpvoted: boolean;
};

export type Comment = {
  id: number;
  userId: string;
  postId: number;
  parrentCommentId: number | null;
  content: string;
  depth: number;
  commentCount: number;
  points: number;
  createdAt: string;
  commentUpvotes: {
    userId: string;
  }[];
  author: {
    id: string;
    username: string;
  }
  childComments?: Comment[];
};

export type PaginatedResponse<T> = {
  pagination: {
    totalPages: number;
    page: number;
  };
  data: T;
} & Omit<SucessResponse, "data">;
