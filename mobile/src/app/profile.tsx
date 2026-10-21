import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button, confirm } from "@/components/ui";
import { authClient } from "@/lib/auth";
import { siteUrl } from "@/lib/config";
import { useSession } from "@/lib/session";
import { C, ui } from "@/lib/theme";
import { PLAN_NAMES } from "@/lib/types";

function ChangePassword() {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  const submit = async () => {
    setBusy(true);
    setNote(null);
    const result = await authClient.changePassword({ currentPassword: current, newPassword: next, revokeOtherSessions: true });
    setBusy(false);
    if (result.error) {
      const code = result.error.code;
      setNote({
        ok: false,
        text:
          code === "INVALID_PASSWORD"
            ? "Текущий пароль неверный."
            : code === "PASSWORD_TOO_SHORT"
              ? "Новый пароль должен быть не короче 8 символов."
              : code === "CREDENTIAL_ACCOUNT_NOT_FOUND"
                ? "У аккаунта нет пароля (вход через Google или VK)."
                : "Не удалось сменить пароль.",
      });
      return;
    }
    setCurrent("");
    setNext("");
    setNote({ ok: true, text: "Пароль изменён. На других устройствах нужно войти заново." });
  };

  if (!open) return <Button title="Сменить пароль" kind="ghost" onPress={() => setOpen(true)} icon={<Ionicons name="key-outline" size={18} color={C.text} />} />;
  return (
    <View style={[ui.card, { gap: 10 }]}>
      <Text style={ui.h2}>Смена пароля</Text>
      <TextInput value={current} onChangeText={setCurrent} placeholder="Текущий пароль" placeholderTextColor={C.faint} secureTextEntry accessibilityLabel="Текущий пароль" style={ui.input} autoCapitalize="none" />
      <TextInput value={next} onChangeText={setNext} placeholder="Новый пароль (от 8 символов)" placeholderTextColor={C.faint} secureTextEntry accessibilityLabel="Новый пароль" style={ui.input} autoCapitalize="none" />
      {note ? <Text style={note.ok ? { color: C.success, fontSize: 14 } : ui.error}>{note.text}</Text> : null}
      <Button title="Сменить пароль" onPress={() => void submit()} busy={busy} disabled={!current || next.length < 8} />
    </View>
  );
}

function DeleteAccount({ onDeleted }: { onDeleted: () => void }) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remove = async () => {
    if (!(await confirm("Удалить аккаунт?", "Чаты, картинки и всё остальное удалятся насовсем. Это нельзя отменить.", "Удалить"))) return;
    setBusy(true);
    setError(null);
    const result = await authClient.deleteUser(password ? { password } : {});
    setBusy(false);
    if (result.error) {
      setError(result.error.code === "SESSION_EXPIRED" ? "Для удаления войдите в аккаунт заново." : result.error.code === "INVALID_PASSWORD" ? "Неверный пароль." : "Не удалось удалить аккаунт.");
      return;
    }
    onDeleted();
  };

  if (!open) return <Button title="Удалить аккаунт" kind="danger" onPress={() => setOpen(true)} icon={<Ionicons name="trash-outline" size={18} color={C.danger} />} />;
  return (
    <View style={[ui.card, { gap: 10, borderColor: "rgba(248,113,113,0.35)" }]}>
      <Text style={ui.h2}>Удаление аккаунта</Text>
      <Text style={ui.muted}>Удалятся чаты, картинки, ассистенты и подписка. Введите пароль, чтобы подтвердить.</Text>
      <TextInput value={password} onChangeText={setPassword} placeholder="Пароль" placeholderTextColor={C.faint} secureTextEntry accessibilityLabel="Пароль для удаления" style={ui.input} autoCapitalize="none" />
      {error ? <Text style={ui.error}>{error}</Text> : null}
      <Button title="Удалить навсегда" kind="danger" onPress={() => void remove()} busy={busy} />
    </View>
  );
}

/** The account: plan, what's left today, password, signing out, deleting it. */
export default function ProfileScreen() {
  const router = useRouter();
  const { me, signOut } = useSession();
  if (!me) return null;
  const chat = me.usage.chat;

  return (
    <SafeAreaView style={ui.screen} edges={["top", "bottom"]}>
      <View style={s.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Назад" onPress={() => router.back()} hitSlop={10} style={s.icon}>
          <Ionicons name="chevron-back" size={24} color={C.text} />
        </Pressable>
        <Text style={ui.h2}>Профиль</Text>
        <View style={s.icon} />
      </View>
      <ScrollView contentContainerStyle={s.body}>
        <View style={s.who}>
          <View style={s.avatar}>
            <Text style={s.avatarText}>{(me.user.name || me.user.email).slice(0, 1).toUpperCase()}</Text>
          </View>
          <Text style={ui.h1}>{me.user.name}</Text>
          <Text style={ui.muted}>{me.user.email}</Text>
        </View>

        <View style={[ui.card, { gap: 10 }]}>
          <Row label="Тариф" value={me.admin ? "Администратор — без лимитов" : PLAN_NAMES[me.plan.id]} />
          <Row label="Кредиты" value={me.credits.toLocaleString("ru-RU")} />
          <Row label="Сообщений сегодня" value={chat.limit === null ? `${chat.used} · без лимита` : `${chat.used} из ${chat.limit}`} />
        </View>

        <ChangePassword />
        <Button title="Выйти" kind="ghost" onPress={() => void signOut().then(() => router.back())} icon={<Ionicons name="log-out-outline" size={18} color={C.text} />} />
        <DeleteAccount onDeleted={() => void signOut().then(() => router.back())} />

        <View style={s.links}>
          <Text style={s.link} onPress={() => void WebBrowser.openBrowserAsync(siteUrl("/terms"))}>
            Условия использования
          </Text>
          <Text style={s.link} onPress={() => void WebBrowser.openBrowserAsync(siteUrl("/privacy"))}>
            Конфиденциальность
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12 }}>
      <Text style={ui.muted}>{label}</Text>
      <Text style={[ui.body, { fontWeight: "600", flexShrink: 1, textAlign: "right" }]}>{value}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  header: { height: 54, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: C.line },
  icon: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  body: { padding: 20, gap: 14, maxWidth: 560, width: "100%", alignSelf: "center" },
  who: { alignItems: "center", gap: 6, marginBottom: 6 },
  avatar: { width: 72, height: 72, borderRadius: 36, backgroundColor: C.accentSoft, alignItems: "center", justifyContent: "center", marginBottom: 6 },
  avatarText: { color: C.accentText, fontSize: 30, fontWeight: "700" },
  links: { flexDirection: "row", justifyContent: "center", gap: 18, marginTop: 10 },
  link: { color: C.faint, fontSize: 13, textDecorationLine: "underline" },
});
