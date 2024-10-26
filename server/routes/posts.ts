import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { and, asc, countDistinct, desc, eq, sql } from "drizzle-orm";

import { db } from "@/adapter";
import type { Context } from "@/context";
import { userTable } from "@/db/schema/auth";
import { commentsTable } from "@/db/schema/comments";
import { postsTable } from "@/db/schema/post";
import { postUpvotesTable } from "@/db/schema/upvotes";
import { loggedIn } from "@/middleware/loggedIn";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";

import {
  type Comment,
  createCommentSchema,
  createPostSchema,
  paginationSchema,
  type PaginatedResponse,
  type Post,
  type SucessResponse,
} from "@/shared/types";
import { getISOFormatDate } from "@/lib/utils";

export const postRouter = new Hono<Context>()
  .post("/", loggedIn, zValidator("form", createPostSchema), async (ctx) => {
    const { title, url, content } = ctx.req.valid("form");
    const user = ctx.get("user")!;
    const [post] = await db
      .insert(postsTable)
      .values({
        title,
        url,
        content,
        userId: user.id,
      })
      .returning({ id: postsTable.id });
    return ctx.json<SucessResponse<{ postId: number }>>(
      {
        success: true,
        message: "Post created",
        data: { postId: post.id },
      },
      201,
    );
  })
  .get("/", zValidator("query", paginationSchema), async (ctx) => {
    const { limit, page, sortBy, order, author, site } = ctx.req.valid("query");
    const user = ctx.get("user");

    const offset = (page - 1) * limit;

    // Sort by points or createdAt
    const sortByColumn =
      sortBy === "points" ? postsTable.points : postsTable.createdAt;
    const sortOrder = order === "desc" ? desc(sortByColumn) : asc(sortByColumn);

    const [count] = await db
      .select({ count: countDistinct(postsTable.id) })
      .from(postsTable)
      .where(
        and(
          author ? eq(postsTable.userId, author) : undefined,
          site ? eq(postsTable.url, site) : undefined,
        ),
      );

    const postQuery = db
      .select({
        id: postsTable.id,
        title: postsTable.title,
        url: postsTable.url,
        content: postsTable.content,
        points: postsTable.points,
        createdAt: getISOFormatDate(postsTable.createdAt),
        commentCount: postsTable.commentCount,
        author: {
          id: userTable.id,
          username: userTable.username,
        },
        isUpvoted: user
          ? sql<boolean>`CASE WHEN ${postUpvotesTable.userId} IS NOT NULL THEN true else false END`
          : sql<boolean>`false`,
      })
      .from(postsTable)
      .leftJoin(userTable, eq(postsTable.userId, userTable.id))
      .orderBy(sortOrder)
      .limit(limit)
      .offset(offset)
      .where(
        and(
          author ? eq(postsTable.userId, author) : undefined,
          site ? eq(postsTable.url, site) : undefined,
        ),
      );

    if (user) {
      postQuery.leftJoin(
        postUpvotesTable,
        and(
          eq(postUpvotesTable.postId, postsTable.id),
          eq(postUpvotesTable.userId, user.id),
        ),
      );
    }

    const post = await postQuery;

    return ctx.json<PaginatedResponse<Post[]>>({
      data: post as Post[],
      success: true,
      message: "Posts fetched",
      pagination: {
        totalPages: Math.ceil(count.count / limit) as number,
        page: page as number,
      },
    });
  })
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
          .from(postUpvotesTable)
          .where(
            and(
              eq(postUpvotesTable.postId, id),
              eq(postUpvotesTable.userId, user.id),
            ),
          )
          .limit(1);

        pointChange = existingUpvote ? -1 : 1;

        const [updated] = await tx
          .update(postsTable)
          .set({ points: sql`${postsTable.points} + ${pointChange}` })
          .where(eq(postsTable.id, id))
          .returning({ points: postsTable.points });

        if (!updated) {
          throw new HTTPException(404, { message: "Post not found" });
        }

        if (existingUpvote) {
          await tx
            .delete(postUpvotesTable)
            .where(eq(postUpvotesTable.id, existingUpvote.id));
        } else {
          await tx
            .insert(postUpvotesTable)
            .values({ postId: id, userId: user.id });
        }

        return updated.points;
      });

      return ctx.json<SucessResponse<{ count: number; isUpvoted: boolean }>>({
        message: "Upvoted",
        success: true,
        data: { count: points, isUpvoted: pointChange > 0 },
      });
    },
  )
  .post(
    "/:id/comment",
    loggedIn,
    zValidator("param", z.object({ id: z.coerce.number() })),
    zValidator("form", createCommentSchema),
    async (ctx) => {
      const { id } = ctx.req.valid("param");
      const { content } = ctx.req.valid("form");
      const user = ctx.get("user")!;

      const [comment] = await db.transaction(async (tx) => {
        const [updated] = await tx
          .update(postsTable)
          .set({ commentCount: sql`${postsTable.commentCount} + 1` })
          .where(eq(postsTable.id, id))
          .returning({ commentCount: postsTable.commentCount });

        if (!updated) {
          throw new HTTPException(404, { message: "Post not found" });
        }

        return await tx
          .insert(commentsTable)
          .values({
            userId: user.id,
            postId: id,
            content,
          })
          .returning({
            id: commentsTable.id,
            userId: commentsTable.userId,
            postId: commentsTable.postId,
            content: commentsTable.content,
            points: commentsTable.points,
            depth: commentsTable.depth,
            commentCount: commentsTable.commentCount,
            parrentCommentId: commentsTable.parentCommentId,
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
          commentUpvotes: [],
          childComments: [],
          author: {
            username: user.username,
            id: user.id,
          },
        },
      });
    },
  );
