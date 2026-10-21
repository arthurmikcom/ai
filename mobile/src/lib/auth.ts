import { expoClient } from "@better-auth/expo/client";
import { anonymousClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { SCHEME, siteUrl } from "./config";

/**
 * Accounts of the site (better-auth). On a phone the session cookie is kept
 * in the secure store and sent by hand; a visitor without an account becomes
 * a guest, like on the site.
 */
export const authClient = createAuthClient({
  baseURL: siteUrl(""),
  plugins: [expoClient({ scheme: SCHEME, storagePrefix: "maryx", storage: SecureStore }), anonymousClient()],
});

/** The session cookie for the app's own API requests (a browser sends it by itself). */
export async function sessionCookie(): Promise<string> {
  return Platform.OS === "web" ? "" : authClient.getCookie();
}
