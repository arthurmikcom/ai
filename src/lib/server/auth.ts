import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { betterAuth, type BetterAuthOptions } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { getDb, schema, type DB } from "./db";
import { cancelStripeForUser, stripeConfigured } from "./billing/stripe";
import { deleteUserFiles } from "./storage";

/** Sign-in methods beyond email + password, enabled by their env keys. */
export function socialProviders() {
  const env = process.env;
  return {
    google: Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
    vk: Boolean(env.VK_CLIENT_ID && env.VK_CLIENT_SECRET),
  };
}

/**
 * BETTER_AUTH_SECRET signs sessions. Required on Vercel; elsewhere a random
 * one is generated once and kept in .data/ so local setup needs no config.
 */
async function resolveSecret(): Promise<string> {
  const fromEnv = process.env.BETTER_AUTH_SECRET?.trim();
  if (fromEnv) return fromEnv;
  if (process.env.VERCEL) {
    throw new Error("BETTER_AUTH_SECRET не задан. Добавьте его в переменные окружения Vercel.");
  }
  const file = path.join(process.cwd(), ".data", "auth-secret");
  try {
    return (await readFile(file, "utf8")).trim();
  } catch {
    const secret = randomBytes(32).toString("base64");
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, secret, { mode: 0o600 });
    return secret;
  }
}

/** Domains of this Vercel project: production plus the per-deployment preview domains. */
export function vercelHosts(): string[] {
  const env = process.env;
  return [env.VERCEL_PROJECT_PRODUCTION_URL, env.VERCEL_BRANCH_URL, env.VERCEL_URL].filter((h): h is string =>
    Boolean(h),
  );
}

function baseURL(): BetterAuthOptions["baseURL"] {
  const env = process.env;
  if (env.BETTER_AUTH_URL) return env.BETTER_AUTH_URL;
  if (env.VERCEL) {
    return {
      allowedHosts: vercelHosts(),
      protocol: "https",
      fallback: env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}` : undefined,
    };
  }
  return undefined; // derived from the request (fine for localhost)
}

function createAuth(db: DB, secret: string) {
  const env = process.env;
  const social = socialProviders();
  return betterAuth({
    appName: "Nexus AI",
    secret,
    baseURL: baseURL(),
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
        rateLimit: schema.rateLimit,
      },
    }),
    emailAndPassword: { enabled: true, minPasswordLength: 8, autoSignIn: true },
    socialProviders: {
      ...(social.google
        ? { google: { clientId: env.GOOGLE_CLIENT_ID!, clientSecret: env.GOOGLE_CLIENT_SECRET! } }
        : {}),
      ...(social.vk ? { vk: { clientId: env.VK_CLIENT_ID!, clientSecret: env.VK_CLIENT_SECRET! } } : {}),
    },
    user: {
      deleteUser: {
        enabled: true,
        // Rows go with the user (ON DELETE CASCADE); stored files and a
        // running Stripe subscription don't, so stop them first.
        beforeDelete: async (user) => {
          if (stripeConfigured()) await cancelStripeForUser(user.id);
          await deleteUserFiles(user.id);
        },
      },
    },
    // Stored in the database so limits hold across serverless instances.
    rateLimit: { enabled: true, storage: "database" },
    plugins: [nextCookies()],
  });
}

type Auth = ReturnType<typeof createAuth>;

const holder = globalThis as typeof globalThis & { __nexusAuth?: Promise<Auth> };

export function getAuth(): Promise<Auth> {
  holder.__nexusAuth ??= Promise.all([getDb(), resolveSecret()])
    .then(([db, secret]) => createAuth(db, secret))
    .catch((err) => {
      holder.__nexusAuth = undefined;
      throw err;
    });
  return holder.__nexusAuth;
}

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image?: string | null;
}

export async function getSessionUser(headers: Headers): Promise<SessionUser | null> {
  const auth = await getAuth();
  const session = await auth.api.getSession({ headers });
  return session?.user ?? null;
}

/**
 * Admins: user ids listed in ADMIN_USER_IDS, or emails in ADMIN_EMAILS once
 * the address is verified (e.g. signed in with Google). A bare email match
 * isn't enough: anyone could register an unclaimed admin address with a
 * password, since sign-up doesn't prove ownership of the email.
 */
export function isAdmin(user: Pick<SessionUser, "id" | "email" | "emailVerified">): boolean {
  const list = (name: string) =>
    (process.env[name] ?? "")
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);
  if (list("ADMIN_USER_IDS").includes(user.id)) return true;
  return user.emailVerified && list("ADMIN_EMAILS").some((e) => e.toLowerCase() === user.email.toLowerCase());
}
