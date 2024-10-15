import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { eq } from "drizzle-orm";

import { db } from "@/adapter";
import type { Context } from "@/context";
import { userTable } from "@/db/schema/auth";
import { lucia } from "@/lucia";
import { zValidator } from "@hono/zod-validator";
import { generateId } from "lucia";
import postgres from "postgres";

import { loginSchema, type SucessResponse } from "@/shared/types";

export const authRouter = new Hono<Context>()
  .post("/signup", zValidator("form", loginSchema), async (c) => {
    const { username, password } = c.req.valid("form");
    const passwordHash = await Bun.password.hash(password);
    const userId = generateId(15);

    try {
      await db.insert(userTable).values({
        id: userId,
        username,
        password_hash: passwordHash,
      });
      console.log("User created successfully");
      const session = await lucia.createSession(userId, { username });
      const sessionCookie = await lucia
        .createSessionCookie(session.id)
        .serialize();

      c.header("Set-Cookie", sessionCookie, { append: true });
      return c.json<SucessResponse>(
        {
          success: true,
          message: "User created successfully",
        },
        201,
      );
    } catch (error) {
      console.log(error);
      if (error instanceof postgres.PostgresError && error.code == "23505") {
        throw new HTTPException(409, { message: "Username already exists" });
      }
      throw new HTTPException(500, { message: "Failed to create user" });
    }
  })
  .post("/login", zValidator("form", loginSchema), async (c) => {
    const { username, password } = c.req.valid("form");
    const [existingUser] = await db
      .select()
      .from(userTable)
      .where(eq(userTable.username, username))
      .limit(1);

    if (!existingUser) {
      throw new HTTPException(404, { message: "User not found" });
    }

    const validPassword = await Bun.password.verify(
      password,
      existingUser.password_hash,
    );
    if (!validPassword) {
      throw new HTTPException(401, { message: "Invalid credentials" });
    }

    const session = await lucia.createSession(existingUser.id, {
      username: existingUser.username,
    });
    const sessionCookie = await lucia
      .createSessionCookie(session.id)
      .serialize();

    c.header("Set-Cookie", sessionCookie, { append: true });
    return c.json<SucessResponse>(
      {
        success: true,
        message: "Logged in successfully",
      },
      200,
    );
  })
  .get("/logout", async (c) => {
    const session = c.get("session");
    if (!session) {
      return c.redirect("/login");
    }
    await lucia.invalidateSession(session.id);
    c.header("Set-Cookie", lucia.createBlankSessionCookie().serialize(), {
      append: true,
    });
  });
