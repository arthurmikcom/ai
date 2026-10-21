import Ionicons from "@expo/vector-icons/Ionicons";
import * as Clipboard from "expo-clipboard";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useSession } from "@/lib/session";
import { C } from "@/lib/theme";
import type { ChatMessage } from "@/lib/types";
import { Markdown } from "./Markdown";
import { BrandMark, Button, remoteImage } from "./ui";

export function Message({ message, onSuggestion }: { message: ChatMessage; onSuggestion: (text: string) => void }) {
  const { cookie } = useSession();
  const router = useRouter();
  const [copied, setCopied] = useState(false);
  const pictures = (message.attachments ?? []).filter((a) => a.mime.startsWith("image/") && a.url && !a.hidden);

  if (message.role === "user") {
    return (
      <View style={s.userRow}>
        {pictures.map((p, i) => (
          <Image key={i} source={remoteImage(p.url!, cookie)} style={s.userPhoto} contentFit="cover" />
        ))}
        {message.content ? (
          <View style={s.userBubble}>
            <Text selectable style={s.userText}>
              {message.content}
            </Text>
          </View>
        ) : null}
      </View>
    );
  }

  const thinking = message.streaming && !message.content && !pictures.length;
  return (
    <View style={s.answer} accessibilityLabel="Ответ MARYX">
      <View style={s.who}>
        <BrandMark size={22} />
        <Text style={s.whoName}>MARYX</Text>
      </View>
      {thinking && (
        <View style={s.thinking}>
          <ActivityIndicator size="small" color={C.accentText} />
          <Text style={s.muted}>{message.status?.split("\n").at(-1) ?? "Думаю…"}</Text>
        </View>
      )}
      {message.content ? <Markdown text={message.content} streaming={message.streaming} /> : null}
      {pictures.map((p, i) => (
        <Image key={i} source={remoteImage(p.url!, cookie)} style={s.picture} contentFit="cover" transition={200} accessibilityLabel="Картинка MARYX" />
      ))}
      {message.notice ? <Text style={s.notice}>{message.notice}</Text> : null}
      {message.error ? (
        message.errorCode === "login" ? (
          <View style={s.loginBox}>
            <Text style={s.loginText}>{message.error}</Text>
            <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
              <Button title="Войти" kind="light" onPress={() => router.push({ pathname: "/login", params: { mode: "signin" } })} style={s.small} />
              <Button title="Зарегистрироваться" kind="ghost" onPress={() => router.push({ pathname: "/login", params: { mode: "signup" } })} style={s.small} />
            </View>
          </View>
        ) : (
          <View style={s.errorBox}>
            <Ionicons name="warning-outline" size={18} color={C.danger} />
            <Text style={s.errorText}>{message.error}</Text>
          </View>
        )
      ) : null}
      {!message.streaming && message.content ? (
        <View style={s.actions}>
          <Pressable
            accessibilityLabel="Копировать ответ"
            hitSlop={8}
            onPress={() => {
              void Clipboard.setStringAsync(message.content).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              });
            }}
          >
            <Ionicons name={copied ? "checkmark" : "copy-outline"} size={18} color={copied ? C.success : C.faint} />
          </Pressable>
        </View>
      ) : null}
      {!message.streaming && message.suggestions?.length ? (
        <View style={s.suggestions}>
          {message.suggestions.slice(0, 3).map((q) => (
            <Pressable key={q} onPress={() => onSuggestion(q)} style={({ pressed }) => [s.chip, pressed && { opacity: 0.7 }]}>
              <Ionicons name="return-down-forward" size={14} color={C.accentText} />
              <Text style={s.chipText}>{q}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  userRow: { alignItems: "flex-end", gap: 6, marginVertical: 6 },
  userBubble: { backgroundColor: C.surface2, borderRadius: 20, borderBottomRightRadius: 6, paddingHorizontal: 16, paddingVertical: 11, maxWidth: "86%" },
  userText: { color: C.text, fontSize: 16, lineHeight: 23 },
  userPhoto: { width: 160, height: 160, borderRadius: 16, backgroundColor: C.surface },
  answer: { gap: 10, marginVertical: 10 },
  who: { flexDirection: "row", alignItems: "center", gap: 8 },
  whoName: { color: C.muted, fontSize: 13, fontWeight: "600" },
  thinking: { flexDirection: "row", alignItems: "center", gap: 10 },
  muted: { color: C.muted, fontSize: 14 },
  picture: { width: "100%", aspectRatio: 1, borderRadius: 16, backgroundColor: C.surface },
  notice: { color: C.faint, fontSize: 13, lineHeight: 18 },
  errorBox: { flexDirection: "row", gap: 8, backgroundColor: C.dangerSoft, borderColor: "rgba(248,113,113,0.3)", borderWidth: 1, borderRadius: 14, padding: 12 },
  errorText: { color: "#fecaca", fontSize: 14, lineHeight: 20, flex: 1 },
  loginBox: { gap: 12, backgroundColor: C.accentSoft, borderColor: "rgba(124,92,255,0.35)", borderWidth: 1, borderRadius: 16, padding: 14 },
  loginText: { color: C.text, fontSize: 15, lineHeight: 21 },
  small: { minHeight: 38, paddingHorizontal: 14, borderRadius: 999 },
  actions: { flexDirection: "row", gap: 16, paddingTop: 2 },
  suggestions: { gap: 8 },
  chip: { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderColor: C.line, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 9, alignSelf: "flex-start", maxWidth: "100%" },
  chipText: { color: C.text, fontSize: 14, flexShrink: 1 },
});
