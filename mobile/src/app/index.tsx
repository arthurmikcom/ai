import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import { useEffect, useRef } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View, type ScrollViewInstance } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Composer } from "@/components/Composer";
import { Message } from "@/components/Message";
import { BrandMark, BrandName, Button } from "@/components/ui";
import { useChats } from "@/lib/chats";
import { useSession } from "@/lib/session";
import { C, ui } from "@/lib/theme";

const IDEAS = [
  { icon: "bulb-outline", text: "Объясни простыми словами, как работает ИИ" },
  { icon: "create-outline", text: "Напиши пост о моём новом проекте" },
  { icon: "airplane-outline", text: "Составь план поездки на 3 дня в Стамбул" },
  { icon: "code-slash-outline", text: "Помоги исправить ошибку в коде" },
] as const;

/** The chat: open the app and write, like ChatGPT — no account needed. */
export default function ChatScreen() {
  const router = useRouter();
  const { me, ready, error, reload } = useSession();
  const { messages, loading, streaming, activeId, send, stop, open } = useChats();
  const scroll = useRef<ScrollViewInstance>(null);
  const guest = Boolean(me?.guest);

  // New words keep the end of the chat in view.
  useEffect(() => {
    const t = setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 30);
    return () => clearTimeout(t);
  }, [messages]);

  if (!ready) {
    return (
      <View style={[ui.screen, s.center]}>
        <ActivityIndicator color={C.accentText} />
      </View>
    );
  }
  if (!me) {
    return (
      <SafeAreaView style={[ui.screen, s.center, { padding: 24, gap: 14 }]}>
        <BrandMark size={56} />
        <Text style={ui.h2}>Нет связи с MARYX</Text>
        <Text style={[ui.muted, { textAlign: "center" }]}>{error ?? "Проверьте интернет и попробуйте ещё раз."}</Text>
        <Button title="Повторить" onPress={() => void reload()} />
      </SafeAreaView>
    );
  }

  const empty = !activeId && messages.length === 0;
  return (
    <SafeAreaView style={ui.screen} edges={["top", "bottom"]}>
      <View style={s.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Меню" onPress={() => router.push("/menu")} style={s.icon} hitSlop={8}>
          <Ionicons name="menu" size={24} color={C.text} />
        </Pressable>
        <View style={s.brand}>
          <BrandMark size={26} />
          <BrandName />
        </View>
        {guest ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Войти" onPress={() => router.push({ pathname: "/login", params: { mode: "signin" } })} style={s.login}>
            <Text style={s.loginText}>Войти</Text>
          </Pressable>
        ) : (
          <Pressable accessibilityRole="button" accessibilityLabel="Новый чат" onPress={() => open(null)} style={s.icon} hitSlop={8}>
            <Ionicons name="create-outline" size={23} color={C.text} />
          </Pressable>
        )}
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        {empty ? (
          <ScrollView contentContainerStyle={s.welcome} keyboardShouldPersistTaps="handled">
            <BrandMark size={64} />
            <Text style={s.hello}>Чем помочь?</Text>
            <Text style={[ui.muted, { textAlign: "center", marginBottom: 8 }]}>Спросите что угодно — MARYX ответит, напишет, объяснит и нарисует.</Text>
            {IDEAS.map((idea) => (
              <Pressable key={idea.text} accessibilityRole="button" onPress={() => send(idea.text)} style={({ pressed }) => [s.idea, pressed && { opacity: 0.7 }]}>
                <Ionicons name={idea.icon} size={18} color={C.accentText} />
                <Text style={s.ideaText}>{idea.text}</Text>
              </Pressable>
            ))}
          </ScrollView>
        ) : (
          <ScrollView ref={scroll} contentContainerStyle={s.list} keyboardShouldPersistTaps="handled">
            {loading && <ActivityIndicator color={C.accentText} style={{ marginTop: 24 }} />}
            {messages.map((m) => (
              <Message key={m.id} message={m} onSuggestion={(q) => send(q)} />
            ))}
          </ScrollView>
        )}
        <View style={s.composer}>
          <Composer guest={guest} streaming={streaming} onSend={send} onStop={stop} />
          <Text style={s.hint}>ИИ может ошибаться. Проверяйте важную информацию.</Text>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  center: { alignItems: "center", justifyContent: "center" },
  header: { height: 54, flexDirection: "row", alignItems: "center", paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: C.line },
  icon: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  brand: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  login: { backgroundColor: C.text, borderRadius: 999, paddingHorizontal: 14, height: 34, justifyContent: "center" },
  loginText: { color: C.bg, fontSize: 14, fontWeight: "700" },
  welcome: { flexGrow: 1, alignItems: "center", justifyContent: "center", padding: 20, gap: 10 },
  hello: { color: C.text, fontSize: 28, fontWeight: "700", letterSpacing: -0.6, marginTop: 6 },
  idea: { flexDirection: "row", alignItems: "center", gap: 10, alignSelf: "stretch", backgroundColor: C.surface, borderColor: C.line, borderWidth: 1, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 13 },
  ideaText: { color: C.text, fontSize: 15, flex: 1 },
  list: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 24 },
  composer: { paddingHorizontal: 12, paddingTop: 6, paddingBottom: 6 },
  hint: { color: C.faint, fontSize: 11, textAlign: "center", marginTop: 6 },
});
