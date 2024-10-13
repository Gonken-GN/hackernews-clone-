import { drizzle } from "drizzle-orm/postgres-js";

import postgres from "postgres";
import { z } from "zod";

const processEnvSchema = z.object({
  DATABASE_URL: z.string().url(),
});

const processEnv = processEnvSchema.parse(process.env);
const queryClient = postgres(processEnv.DATABASE_URL);

const db = drizzle(queryClient);


