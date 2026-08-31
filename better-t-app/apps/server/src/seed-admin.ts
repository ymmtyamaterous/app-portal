import { db, initializeDatabase } from "@better-t-app/db";
import { account, user } from "@better-t-app/db/schema/auth";
import { createLocalAccountIssuer } from "better-auth/db";
import { hashPassword } from "better-auth/crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";

const argumentsSchema = z.tuple([
  z.email(),
  z.string().min(12).max(128),
  z.string().trim().min(1).max(100).default("Portal administrator"),
]);

async function main() {
  const input = argumentsSchema.parse(process.argv.slice(2));
  const [email, password, name] = input;
  const normalizedEmail = email.toLowerCase();

  await initializeDatabase();
  const existingUser = await db.query.user.findFirst({
    where: eq(user.email, normalizedEmail),
  });
  if (existingUser) {
    throw new Error("An account with this email address already exists.");
  }

  const now = new Date();
  const userId = crypto.randomUUID();
  await db.batch([
    db.insert(user).values({
      id: userId,
      email: normalizedEmail,
      name,
      emailVerified: true,
      role: "admin",
      createdAt: now,
      updatedAt: now,
    }),
    db.insert(account).values({
      id: crypto.randomUUID(),
      accountId: userId,
      providerId: "credential",
      issuer: createLocalAccountIssuer("credential"),
      userId,
      password: await hashPassword(password),
      createdAt: now,
      updatedAt: now,
    }),
  ]);

  console.log("Initial administrator created.");
}

await main();