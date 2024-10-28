import { drizzle } from "drizzle-orm/postgres-js";

import { DrizzlePostgreSQLAdapter } from "@lucia-auth/adapter-drizzle";
import postgres from "postgres";
import { z } from "zod";

import { sessionTable, userRelations, userTable } from "./db/schema/auth";
import { commentRelations, commentsTable } from "./db/schema/comments";
import { postsRelations, postsTable } from "./db/schema/post";
import {
  commentUpvotesRelation,
  commentUpvotesTable,
  postUpvotesRelation,
  postUpvotesTable,
} from "./db/schema/upvotes";

const processEnvSchema = z.object({
  DATABASE_URL: z.string().url(),
});

const processEnv = processEnvSchema.parse(process.env);
const queryClient = postgres(processEnv.DATABASE_URL);
export const db = drizzle(queryClient, {
  schema: {
    user: userTable,
    session: sessionTable,
    posts: postsTable,
    comments: commentsTable,
    postUpvotes: postUpvotesTable,
    commentUpvotes: commentUpvotesTable,
    postRelations: postsRelations,
    commmentUpvotes: commentUpvotesRelation,
    postUpvotesRelation: postUpvotesRelation,
    userRelations: userRelations,
    commentRelations: commentRelations,
  },
});

export const adapter = new DrizzlePostgreSQLAdapter(
  db,
  sessionTable,
  userTable,
);
