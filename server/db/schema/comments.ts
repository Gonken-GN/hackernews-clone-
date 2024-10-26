import { relations } from "drizzle-orm";
import { integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

import { createInsertSchema } from "drizzle-zod";

import { userTable } from "./auth";
import { postsTable } from "./post";
import { commentUpvotesTable } from "./upvotes";
import { z } from "zod";

export const commentsTable = pgTable("comments", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  postId: integer("post_id").notNull(),
  parentCommentId: integer("parent_comment_id"),
  content: text("content").notNull(),
  depth: integer("depth").default(0).notNull(),
  commentCount: integer("comment_count").default(0).notNull(),
  points: integer("points").default(0).notNull(),
  createdAt: timestamp("created_at", {
    withTimezone: true,
  })
    .defaultNow()
    .notNull(),
});

export const commentRelations = relations(commentsTable, ({ one, many }) => ({
  author: one(userTable, {
    fields: [commentsTable.userId],
    references: [userTable.id],
    relationName: "author",
  }),
  parentComment: one(commentsTable, {
    fields: [commentsTable.parentCommentId],
    references: [commentsTable.id],
    relationName: "childComments",
  }),
  childComments: many(commentsTable, {
    relationName: "childComments",
  }),
  post: one(postsTable, {
    fields: [commentsTable.postId],
    references: [postsTable.id],
    relationName: "post",
  }),
  commentUpVotes: many(commentUpvotesTable, { relationName: "commentUpvotes" }),
}));

export const insertCommentSchema = createInsertSchema(commentsTable, {
  content: z.string().min(3, "Content must be at least 3 characters"),
});
