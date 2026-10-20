"use client";

import { anonymousClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

/** Talks to /api/auth on the same origin; guests sign in anonymously (see the server's guests.ts). */
export const authClient = createAuthClient({ plugins: [anonymousClient()] });
