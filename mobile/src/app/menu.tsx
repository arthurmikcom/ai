import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { BrandMark, BrandName, Button, confirm, useAskToSignIn } from "@/components/ui";
import { useChats } from "@/lib/chats";
import { useSession } from "@/lib/session";
import { C, ui } from "@/lib/theme";
import { PLAN_NAMES } from "@/lib/types";

/** The menu: a new chat, the sections, the chat history and the account. */
export default function MenuScreen() {
  const router = useRouter();
  const ask = useAskToSignIn();
  const { me } = useSession();
  const { chats, activeId, open, remove } = useChats();
  const guest = Boolean(me?.guest);

  const go = (id: string | null) => {
    open(id);
    router.back();
  };

  return (
    <SafeAreaView style={ui.screen} edges={["top", "bottom"]}>
      <View style={s.header}>
        <BrandMark size={28} />
        <BrandName />
        <View style={{ flex: 1 }} />
        <Pressable accessibilityRole="button" accessibilityLabel="Закрыть меню" onPress={() => router.back()} hitSlop={10} style={s.close}>
          <Ionicons name="close" size={24} color={C.text} />
        </Pressable>
      </View>

      <View style={s.top}>
        <Button title="Новый чат" onPress={() => go(null)} icon={<Ionicons name="add" size={20} color={C.text} />} />
        <Pressable
          accessibilityRole="button"
          onPress={() => (guest ? ask("создавать картинки") : router.replace("/images"))}
          style={({ pressed }) => [s.row, pressed && { opacity: 0.7 }]}
        >
          <Ionicons name="image-outline" size={20} color={C.accentText} />
          <Text style={s.rowText}>Изображения</Text>
        </Pressable>
      </View>

      <Text style={s.section}>Ваши чаты</Text>
      <FlatList
        data={chats}
        keyExtractor={(c) => c.id}
        contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 12 }}
        ListEmptyComponent={<Text style={[ui.muted, { paddingHorizontal: 8 }]}>Здесь будут ваши чаты. Начните новый — и он появится здесь.</Text>}
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            onPress={() => go(item.id)}
            onLongPress={() => {
              void confirm("Удалить чат?", `«${item.title}» удалится насовсем.`, "Удалить").then((yes) => yes && remove(item.id));
            }}
            accessibilityHint="Долгое нажатие — удалить"
            style={({ pressed }) => [s.chat, item.id === activeId && s.chatOn, pressed && { opacity: 0.7 }]}
          >
            <Text numberOfLines={1} style={s.chatText}>
              {item.title}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Удалить чат «${item.title}»`}
              hitSlop={8}
              onPress={() => {
                void confirm("Удалить чат?", `«${item.title}» удалится насовсем.`, "Удалить").then((yes) => yes && remove(item.id));
              }}
            >
              <Ionicons name="trash-outline" size={17} color={C.faint} />
            </Pressable>
          </Pressable>
        )}
      />

      <View style={s.bottom}>
        {guest ? (
          <View style={[ui.card, { gap: 10 }]}>
            <Text style={ui.h2}>Сохраняйте чаты и пользуйтесь всем</Text>
            <Text style={ui.muted}>Картинки, фото и больше сообщений — после бесплатной регистрации. Чаты отсюда останутся с вами.</Text>
            <Button title="Зарегистрироваться" onPress={() => router.replace({ pathname: "/login", params: { mode: "signup" } })} />
            <Button title="Войти" kind="ghost" onPress={() => router.replace({ pathname: "/login", params: { mode: "signin" } })} />
          </View>
        ) : me ? (
          <Pressable accessibilityRole="button" onPress={() => router.replace("/profile")} style={({ pressed }) => [s.me, pressed && { opacity: 0.7 }]} accessibilityLabel="Профиль">
            <View style={s.avatar}>
              <Text style={s.avatarText}>{(me.user.name || me.user.email).slice(0, 1).toUpperCase()}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text numberOfLines={1} style={s.meName}>
                {me.user.name || me.user.email}
              </Text>
              <Text style={ui.muted}>
                {me.admin ? "Без лимитов" : `${PLAN_NAMES[me.plan.id]} · ${me.credits.toLocaleString("ru-RU")} кр.`}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={C.faint} />
          </Pressable>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, height: 56 },
  close: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  top: { paddingHorizontal: 16, gap: 8, paddingBottom: 8 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, height: 48, borderRadius: 14, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line },
  rowText: { color: C.text, fontSize: 15 },
  section: { color: C.faint, fontSize: 12, fontWeight: "700", letterSpacing: 1, textTransform: "uppercase", paddingHorizontal: 20, paddingTop: 14, paddingBottom: 6 },
  chat: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, height: 46, borderRadius: 12 },
  chatOn: { backgroundColor: C.surface2 },
  chatText: { color: C.text, fontSize: 15, flex: 1 },
  bottom: { padding: 16, borderTopWidth: 1, borderTopColor: C.line },
  me: { flexDirection: "row", alignItems: "center", gap: 12 },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: C.accentSoft, alignItems: "center", justifyContent: "center" },
  avatarText: { color: C.accentText, fontSize: 17, fontWeight: "700" },
  meName: { color: C.text, fontSize: 15, fontWeight: "600" },
});
