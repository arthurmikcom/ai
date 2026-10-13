import { toNextJsHandler } from "better-auth/next-js";
import { getAuth } from "@/lib/server/auth";

export const { GET, POST } = toNextJsHandler(async (request) => (await getAuth()).handler(request));
