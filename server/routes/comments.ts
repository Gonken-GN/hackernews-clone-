import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { and, asc, countDistinct, desc, eq, isNull, sql } from "drizzle-orm";

import { db } from "@/adapter";
import { type Context } from "@/context";
import { commentsTable } from "@/db/schema/comments";
import { postsTable } from "@/db/schema/post";
import { commentUpvotesTable } from "@/db/schema/upvotes";
import { loggedIn } from "@/middleware/loggedIn";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";

import {
  createCommentSchema,
  paginationSchema,
  type Comment,
  type PaginatedResponse,
  type SucessResponse,
} from "@/shared/types";
import { getISOFormatDate } from "@/lib/utils";

export const commentRouter = new Hono<Context>()
  .post(
    "/:id",
    loggedIn,
    zValidator("param", z.object({ id: z.coerce.number() })),
    zValidator("form", createCommentSchema),
    async (ctx) => {
      const { id } = ctx.req.valid("param");
      const { content } = ctx.req.valid("form");
      const user = ctx.get("user")!;

      const [comment] = await db.transaction(async (tx) => {
        const [parentComment] = await tx
          .select({
            id: commentsTable.id,
            postId: commentsTable.postId,
            depth: commentsTable.depth,
          })
          .from(commentsTable)
          .where(eq(commentsTable.id, id))
          .limit(1);

        if (!parentComment) {
          throw new HTTPException(404, {
            message: "Comment not found",
          });
        }

        const postId = parentComment.postId;

        const [updateParentComment] = await tx
          .update(commentsTable)
          .set({ commentCount: sql`${commentsTable.commentCount} + 1` })
          .where(eq(commentsTable.id, id))
          .returning({ commentCount: commentsTable.commentCount });

        const [updatedPost] = await tx
          .update(postsTable)
          .set({ commentCount: sql`${postsTable.commentCount} + 1` })
          .where(eq(postsTable.id, postId))
          .returning({ commentCount: postsTable.commentCount });

        if (!updateParentComment || !updatedPost) {
          throw new HTTPException(404, { message: "Comment not found" });
        }
        return await tx
          .insert(commentsTable)
          .values({
            content,
            userId: user.id,
            postId: postId,
            parentCommentId: parentComment.id,
            depth: parentComment.depth + 1,
          })
          .returning({
            id: commentsTable.id,
            userId: commentsTable.userId,
            postId: commentsTable.postId,
            content: commentsTable.content,
            points: commentsTable.points,
            depth: commentsTable.depth,
            commentCount: commentsTable.commentCount,
            parentCommentId: commentsTable.parentCommentId,
            createdAt: getISOFormatDate(commentsTable.createdAt).as(
              "created_at",
            ),
          });
      });
      return ctx.json<SucessResponse<Comment>>({
        success: true,
        message: "Comment created",
        data: {
          ...comment,
          childComments: [],
          commentUpVotes: [],
          author: {
            username: user.username,
            id: user.id,
          },
        } as Comment,
      });
    },
  )
  .post(
    "/:id/upvote",
    loggedIn,
    zValidator("param", z.object({ id: z.coerce.number() })),
    async (ctx) => {
      const { id } = ctx.req.valid("param");
      const user = ctx.get("user")!;

      let pointChange: -1 | 1 = 1;

      const points = await db.transaction(async (tx) => {
        const [existingUpvote] = await tx
          .select()
          .from(commentUpvotesTable)
          .where(
            and(
              eq(commentUpvotesTable.commentId, id),
              eq(commentUpvotesTable.userId, user.id),
            ),
          )
          .limit(1);

        pointChange = existingUpvote ? -1 : 1;

        const [updated] = await tx
          .update(commentsTable)
          .set({ points: sql`${commentsTable.points} + ${pointChange}` })
          .where(eq(commentsTable.id, id))
          .returning({ points: commentsTable.points });

        if (!updated) {
          throw new HTTPException(404, { message: "Post not found" });
        }

        if (existingUpvote) {
          await tx
            .delete(commentUpvotesTable)
            .where(eq(commentUpvotesTable.id, existingUpvote.id));
        } else {
          await tx
            .insert(commentUpvotesTable)
            .values({ commentId: id, userId: user.id });
        }

        return updated.points;
      });

      return ctx.json<
        SucessResponse<{ count: number; commentUpvotes: { userId: string }[] }>
      >({
        message: "Upvoted",
        success: true,
        data: {
          count: points,
          commentUpvotes: pointChange === 1 ? [{ userId: user.id }] : [],
        },
      });
    },
  )
  .get(
    "/:id/comments",
    zValidator("param", z.object({ id: z.coerce.number() })),
    zValidator("query", paginationSchema),
    async (ctx) => {
      const { id } = ctx.req.valid("param");
      const user = ctx.get("user")!;
      const { limit, page, sortBy, order } = ctx.req.valid("query");

      const offset = (page - 1) * limit;
      const sortByColumn =
        sortBy === "points" ? commentsTable.points : commentsTable.createdAt;
      const sortOrder =
        order === "desc" ? desc(sortByColumn) : asc(sortByColumn);

      const [count] = await db
        .select({ count: countDistinct(commentsTable.id) })
        .from(commentsTable)
        .where(eq(commentsTable.parentCommentId, id));

      const comments = await db.query.comments.findMany({
        where: and(
          eq(commentsTable.parentCommentId, id),
        ),
        orderBy: sortOrder,
        limit: limit,
        offset: offset,
        with: {
          author: {
            columns: {
              username: true,
              id: true,
            },
          },
          commentUpVotes: {
            columns: { userId: true },
            where: eq(commentUpvotesTable.userId, user?.id ?? ""),
            limit: 1,
          },
        },
        extras: {
          createdAt: getISOFormatDate(commentsTable.createdAt).as("created_at"),
        },
      });

      return ctx.json<PaginatedResponse<Comment[]>>({
        success: true,
        message: "Comments fetched",
        data: comments as Comment[],
        pagination: {
          page,
          totalPages: Math.ceil(count.count / limit),
        },
      });
    },
  );
