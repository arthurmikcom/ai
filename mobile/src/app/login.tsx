import Ionicons from "@expo/vector-icons/Ionicons";
import * as WebBrowser from "expo-web-browser";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { BrandMark, Button } from "@/components/ui";
import { authClient } from "@/lib/auth";
import { siteUrl } from "@/lib/config";
import { useSession } from "@/lib/session";
import { C, ui } from "@/lib/theme";

type Mode = "signin" | "signup" | "forgot";

const ERRORS: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: "Неверная почта или пароль.",
  USER_ALREADY_EXISTS: "Аккаунт с этой почтой уже есть — войдите.",
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: "Аккаунт с этой почтой уже есть — войдите.",
  PASSWORD_TOO_SHORT: "Пароль должен быть не короче 8 символов.",
  INVALID_EMAIL: "Проверьте адрес почты.",
};

const TITLES: Record<Mode, [string, string]> = {
  signin: ["Вход в MARYX Ai", "Хорошие идеи начинаются с диалога. Продолжим?"],
  signup: ["Регистрация", "Бесплатно. Ваши чаты отсюда останутся с вами."],
  forgot: ["Забыли пароль?", "Укажите почту аккаунта — пришлём ссылку, чтобы задать новый пароль."],
};

const failure = (status: number | undefined, code?: string) =>
  ERRORS[code ?? ""] ??
  (status === 429 ? "Слишком много попыток — подождите минуту и попробуйте снова." : status === 0 || status === undefined ? "Нет связи с сервером. Проверьте интернет." : "Не получилось. Попробуйте ещё раз.");

/** Sign in, sign up or ask for a new password (the same accounts as the site). */
export default function LoginScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ mode?: string }>();
  const { reload } = useSession();
  const [mode, setMode] = useState<Mode>(params.mode === "signup" ? "signup" : "signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const go = (next: Mode) => {
    setMode(next);
    setError(null);
    setSent(false);
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    if (mode === "forgot") {
      const result = await authClient.requestPasswordReset({ email: email.trim(), redirectTo: "/reset-password" });
      setBusy(false);
      if (result.error) setError(failure(result.error.status, result.error.code));
      else setSent(true);
      return;
    }
    const result =
      mode === "signup"
        ? await authClient.signUp.email({ name: name.trim() || email.split("@")[0], email: email.trim(), password })
        : await authClient.signIn.email({ email: email.trim(), password });
    if (result.error) {
      setBusy(false);
      setError(failure(result.error.status, result.error.code));
      return;
    }
    // The guest's chats are the account's now (the server moved them): load everything for it.
    await reload();
    setBusy(false);
    router.back();
  };

  return (
    <SafeAreaView style={ui.screen} edges={["top", "bottom"]}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={s.bar}>
          <Pressable accessibilityRole="button" accessibilityLabel="Закрыть" onPress={() => router.back()} hitSlop={10} style={s.close}>
            <Ionicons name="close" size={24} color={C.text} />
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
          <BrandMark size={52} />
          <Text style={ui.h1}>{TITLES[mode][0]}</Text>
          <Text style={[ui.muted, { marginBottom: 8 }]}>{TITLES[mode][1]}</Text>

          {mode === "forgot" && sent ? (
            <View style={s.sent}>
              <Text style={s.sentText}>
                Если аккаунт с почтой {email.trim()} есть, мы отправили на неё письмо со ссылкой. Ссылка действует 1 час. Не видите письма — загляните в «Спам».
              </Text>
            </View>
          ) : (
            <>
              {mode === "signup" && (
                <TextInput value={name} onChangeText={setName} placeholder="Как вас зовут" placeholderTextColor={C.faint} accessibilityLabel="Как вас зовут" autoComplete="name" style={ui.input} />
              )}
              <TextInput
                value={email}
                onChangeText={setEmail}
                placeholder="Почта"
                placeholderTextColor={C.faint}
                accessibilityLabel="Почта"
                autoComplete="email"
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                style={ui.input}
              />
              {mode !== "forgot" && (
                <TextInput
                  value={password}
                  onChangeText={setPassword}
                  placeholder={mode === "signup" ? "Пароль (от 8 символов)" : "Пароль"}
                  placeholderTextColor={C.faint}
                  accessibilityLabel="Пароль"
                  secureTextEntry
                  autoComplete={mode === "signup" ? "new-password" : "current-password"}
                  autoCapitalize="none"
                  style={ui.input}
                />
              )}
              {mode === "signin" && (
                <Pressable accessibilityRole="button" onPress={() => go("forgot")} style={{ alignSelf: "flex-end" }} hitSlop={8}>
                  <Text style={s.link}>Забыли пароль?</Text>
                </Pressable>
              )}
              {error ? <Text style={[ui.error, s.errorBox]}>{error}</Text> : null}
              <Button
                title={mode === "signin" ? "Войти" : mode === "signup" ? "Создать аккаунт" : "Прислать ссылку"}
                onPress={() => void submit()}
                busy={busy}
                disabled={!email.trim() || (mode !== "forgot" && password.length < (mode === "signup" ? 8 : 1))}
                style={{ marginTop: 4 }}
              />
            </>
          )}

          <View style={s.switch}>
            {mode === "forgot" ? (
              <Pressable accessibilityRole="button" onPress={() => go("signin")} hitSlop={8}>
                <Text style={s.link}>← Назад ко входу</Text>
              </Pressable>
            ) : (
              <Text style={ui.muted}>
                {mode === "signin" ? "Нет аккаунта? " : "Уже есть аккаунт? "}
                <Text style={s.link} onPress={() => go(mode === "signin" ? "signup" : "signin")}>
                  {mode === "signin" ? "Зарегистрироваться" : "Войти"}
                </Text>
              </Text>
            )}
          </View>
          <Text style={s.legal}>
            Продолжая, вы принимаете{" "}
            <Text style={s.legalLink} onPress={() => void WebBrowser.openBrowserAsync(siteUrl("/terms"))}>
              условия
            </Text>{" "}
            и{" "}
            <Text style={s.legalLink} onPress={() => void WebBrowser.openBrowserAsync(siteUrl("/privacy"))}>
              политику конфиденциальности
            </Text>
            .
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  bar: { height: 52, flexDirection: "row", justifyContent: "flex-end", paddingHorizontal: 12 },
  close: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  body: { padding: 24, paddingTop: 4, gap: 12, maxWidth: 480, width: "100%", alignSelf: "center" },
  link: { color: C.accentText, fontSize: 14, fontWeight: "600" },
  errorBox: { backgroundColor: C.dangerSoft, borderRadius: 12, padding: 12 },
  sent: { backgroundColor: "rgba(110,231,183,0.08)", borderColor: "rgba(110,231,183,0.25)", borderWidth: 1, borderRadius: 14, padding: 14 },
  sentText: { color: "#bbf7d0", fontSize: 15, lineHeight: 22 },
  switch: { alignItems: "center", marginTop: 10 },
  legal: { color: C.faint, fontSize: 12, lineHeight: 18, textAlign: "center", marginTop: 14 },
  legalLink: { color: C.muted, textDecorationLine: "underline" },
});
