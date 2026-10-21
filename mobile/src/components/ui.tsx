import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { ActivityIndicator, Alert, Modal, Platform, Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from "react-native";
import { siteUrl } from "@/lib/config";
import { C } from "@/lib/theme";

export function BrandMark({ size = 28 }: { size?: number }) {
  return <Image source={require("@/assets/images/logo.png")} style={{ width: size, height: size, borderRadius: size * 0.26 }} accessibilityIgnoresInvertColors />;
}

export function BrandName() {
  return (
    <Text style={{ color: C.text, fontSize: 18, fontWeight: "800", letterSpacing: -0.4 }}>
      MARYX <Text style={{ color: "#b48cff" }}>Ai</Text>
    </Text>
  );
}

export function Button({
  title,
  onPress,
  kind = "primary",
  busy = false,
  disabled = false,
  style,
  icon,
}: {
  title: string;
  onPress: () => void;
  kind?: "primary" | "ghost" | "danger" | "light";
  busy?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  icon?: ReactNode;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      onPress={onPress}
      disabled={disabled || busy}
      style={({ pressed }) => [b.base, b[kind], (disabled || busy) && { opacity: 0.5 }, pressed && { opacity: 0.8 }, style]}
    >
      {busy ? <ActivityIndicator color={kind === "light" ? C.bg : C.text} /> : icon}
      <Text style={[b.text, kind === "light" && { color: C.bg }, kind === "danger" && { color: C.danger }]}>{title}</Text>
    </Pressable>
  );
}

const b = StyleSheet.create({
  base: { minHeight: 48, borderRadius: 14, paddingHorizontal: 18, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  primary: { backgroundColor: C.accent },
  light: { backgroundColor: C.text },
  ghost: { borderWidth: 1, borderColor: C.lineStrong },
  danger: { borderWidth: 1, borderColor: "rgba(248,113,113,0.4)" },
  text: { color: C.text, fontSize: 15, fontWeight: "600" },
});

/** A remote picture of the user's (the site's files need the session). */
export function remoteImage(url: string, cookie: string) {
  const uri = url.startsWith("/") ? siteUrl(url) : url;
  return { uri, headers: cookie && url.startsWith("/") ? { cookie } : undefined };
}

/** Yes or no (a browser's own dialog on the web build, where Alert does nothing). */
export function confirm(title: string, message: string, yes: string): Promise<boolean> {
  if (Platform.OS === "web") return Promise.resolve(window.confirm(`${title}\n\n${message}`));
  return new Promise((resolve) =>
    Alert.alert(title, message, [
      { text: "Отмена", style: "cancel", onPress: () => resolve(false) },
      { text: yes, style: "destructive", onPress: () => resolve(true) },
    ]),
  );
}

// ---------- «Нужен аккаунт»: what a guest is told about pictures, files and the rest ----------

const AskCtx = createContext<(what: string) => void>(() => {});

/** Asks a guest to sign up for `what` ("создавать картинки"…). */
export function useAskToSignIn(): (what: string) => void {
  return useContext(AskCtx);
}

export function SignInAskProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [what, setWhat] = useState<string | null>(null);
  const ask = useCallback((w: string) => setWhat(w), []);
  const go = (mode: "signin" | "signup") => {
    setWhat(null);
    router.push({ pathname: "/login", params: { mode } });
  };
  return (
    <AskCtx.Provider value={ask}>
      {children}
      <Modal visible={what !== null} transparent animationType="fade" onRequestClose={() => setWhat(null)}>
        <Pressable style={a.backdrop} onPress={() => setWhat(null)}>
          <Pressable style={a.sheet} accessibilityRole="none" accessibilityLabel="Нужен аккаунт">
            <BrandMark size={40} />
            <Text style={a.title}>Нужен аккаунт</Text>
            <Text style={a.text}>Чтобы {what}, войдите или зарегистрируйтесь — это бесплатно. Чаты, которые вы уже начали, останутся с вами.</Text>
            <Button title="Зарегистрироваться бесплатно" onPress={() => go("signup")} style={{ alignSelf: "stretch" }} />
            <Button title="Войти" kind="ghost" onPress={() => go("signin")} style={{ alignSelf: "stretch" }} />
            <Pressable accessibilityRole="button" onPress={() => setWhat(null)} hitSlop={10}>
              <Text style={a.later}>Не сейчас</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </AskCtx.Provider>
  );
}

const a = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.65)", justifyContent: "center", padding: 24 },
  sheet: { backgroundColor: C.surface, borderRadius: 22, borderWidth: 1, borderColor: C.line, padding: 22, alignItems: "center", gap: 12, maxWidth: 420, width: "100%", alignSelf: "center" },
  title: { color: C.text, fontSize: 20, fontWeight: "700", marginTop: 4 },
  text: { color: C.muted, fontSize: 15, lineHeight: 22, textAlign: "center", marginBottom: 6 },
  later: { color: C.faint, fontSize: 14, marginTop: 4 },
});
