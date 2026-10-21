import { DarkTheme, SplashScreen, Stack, ThemeProvider } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { SignInAskProvider } from "@/components/ui";
import { ChatsProvider } from "@/lib/chats";
import { SessionProvider, useSession } from "@/lib/session";
import { C } from "@/lib/theme";

void SplashScreen.preventAutoHideAsync();

const theme = { ...DarkTheme, colors: { ...DarkTheme.colors, background: C.bg, card: C.bg, primary: C.accent, text: C.text, border: C.line } };

/** The splash screen stays until the app knows who is using it (an account, or a new guest). */
function Screens() {
  const { ready } = useSession();
  useEffect(() => {
    if (ready) void SplashScreen.hideAsync();
  }, [ready]);
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: C.bg } }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="menu" options={{ presentation: "modal" }} />
      <Stack.Screen name="login" options={{ presentation: "modal" }} />
      <Stack.Screen name="images" />
      <Stack.Screen name="profile" />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <ThemeProvider value={theme}>
        <SessionProvider>
          <ChatsProvider>
            <SignInAskProvider>
              <StatusBar style="light" />
              <Screens />
            </SignInAskProvider>
          </ChatsProvider>
        </SessionProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
