import Ionicons from "@expo/vector-icons/Ionicons";
import { File, Paths } from "expo-file-system";
import { Image } from "expo-image";
import * as MediaLibrary from "expo-media-library";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View, useWindowDimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button, remoteImage } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { siteUrl } from "@/lib/config";
import { useSession } from "@/lib/session";
import { C, ui } from "@/lib/theme";
import type { MediaItem } from "@/lib/types";

const RATIOS = [
  { id: "1:1", label: "Квадрат" },
  { id: "9:16", label: "Сторис" },
  { id: "16:9", label: "Широкая" },
] as const;

/** «Изображения»: a picture from words, and the user's gallery (the same as on the site). */
export default function ImagesScreen() {
  const router = useRouter();
  const { me, cookie, reload } = useSession();
  const { width } = useWindowDimensions();
  const [items, setItems] = useState<MediaItem[]>([]);
  const [prompt, setPrompt] = useState("");
  const [ratio, setRatio] = useState<(typeof RATIOS)[number]["id"]>("1:1");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shown, setShown] = useState<MediaItem | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const load = useCallback(() => {
    api<MediaItem[]>("/api/media?kind=image").then(setItems, () => {});
  }, []);
  useEffect(load, [load]);

  // A picture still being made is asked about until it's ready.
  useEffect(() => {
    const pending = items.filter((i) => i.status === "pending");
    if (!pending.length) return;
    const timer = setTimeout(() => {
      void Promise.all(pending.map((p) => api<MediaItem>(`/api/media/${p.id}`).catch(() => p))).then((fresh) =>
        setItems((list) => list.map((i) => fresh.find((f) => f.id === i.id) ?? i)),
      );
    }, 3000);
    return () => clearTimeout(timer);
  }, [items]);

  const create = async () => {
    const text = prompt.trim();
    if (!text) return;
    setBusy(true);
    setError(null);
    try {
      const item = await api<MediaItem>("/api/generate", { method: "POST", body: { kind: "image", provider: "maryx", model: "maryx-image", prompt: text, aspectRatio: ratio } });
      setItems((list) => [item, ...list.filter((i) => i.id !== item.id)]);
      if (item.status === "failed") setError(item.error ?? "Не получилось нарисовать. Попробуйте другое описание.");
      else setPrompt("");
      void reload();
    } catch (err) {
      setError(err instanceof ApiError || err instanceof Error ? err.message : String(err));
    }
    setBusy(false);
  };

  const save = async (item: MediaItem) => {
    const file = item.files[0];
    if (!file) return;
    setSaved(null);
    try {
      if (Platform.OS === "web") {
        window.open(siteUrl(file.url), "_blank");
        return;
      }
      const { granted } = await MediaLibrary.requestPermissionsAsync(true);
      if (!granted) return setSaved("Нет доступа к галерее — разрешите его в настройках телефона.");
      const local = await File.downloadFileAsync(siteUrl(file.url), Paths.cache, { headers: cookie ? { cookie } : undefined, idempotent: true });
      await MediaLibrary.Asset.create(local.uri);
      setSaved("Сохранено в галерею");
    } catch {
      setSaved("Не удалось сохранить. Попробуйте ещё раз.");
    }
  };

  const size = (Math.min(width, 720) - 16 * 2 - 8) / 2;
  if (me?.guest) {
    return (
      <SafeAreaView style={[ui.screen, { padding: 24, justifyContent: "center", gap: 12 }]}>
        <Text style={ui.h1}>Изображения — после входа</Text>
        <Text style={ui.muted}>Зарегистрируйтесь — это бесплатно. Картинки по описанию и обработка ваших фото.</Text>
        <Button title="Зарегистрироваться" onPress={() => router.replace({ pathname: "/login", params: { mode: "signup" } })} />
        <Button title="Назад в чат" kind="ghost" onPress={() => router.back()} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={ui.screen} edges={["top", "bottom"]}>
      <View style={s.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Назад" onPress={() => router.back()} hitSlop={10} style={s.icon}>
          <Ionicons name="chevron-back" size={24} color={C.text} />
        </Pressable>
        <Text style={ui.h2}>Изображения</Text>
        <View style={s.icon} />
      </View>
      <FlatList
        data={items.filter((i) => i.status !== "failed")}
        keyExtractor={(i) => i.id}
        numColumns={2}
        columnWrapperStyle={{ gap: 8 }}
        contentContainerStyle={{ padding: 16, gap: 8, maxWidth: 720, width: "100%", alignSelf: "center" }}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View style={{ gap: 10, marginBottom: 8 }}>
            <TextInput
              value={prompt}
              onChangeText={setPrompt}
              placeholder="Опишите картинку: кот-астронавт в неоновом городе…"
              placeholderTextColor={C.faint}
              accessibilityLabel="Описание картинки"
              multiline
              style={[ui.input, { minHeight: 84, textAlignVertical: "top" }]}
            />
            <View style={{ flexDirection: "row", gap: 8 }}>
              {RATIOS.map((r) => (
                <Pressable key={r.id} accessibilityRole="button" onPress={() => setRatio(r.id)} accessibilityState={{ selected: ratio === r.id }} style={[s.ratio, ratio === r.id && s.ratioOn]}>
                  <Text style={[s.ratioText, ratio === r.id && { color: C.accentText }]}>{r.label}</Text>
                </Pressable>
              ))}
            </View>
            {error ? <Text style={ui.error}>{error}</Text> : null}
            <Button title={busy ? "Рисую…" : "Создать"} onPress={() => void create()} busy={busy} disabled={!prompt.trim()} />
            {items.length > 0 && <Text style={s.section}>Ваши картинки</Text>}
          </View>
        }
        ListEmptyComponent={<Text style={[ui.muted, { textAlign: "center", marginTop: 24 }]}>Здесь будут ваши картинки.</Text>}
        renderItem={({ item }) => (
          <Pressable accessibilityRole="button" onPress={() => item.status === "succeeded" && setShown(item)} style={[s.tile, { width: size, height: size }]} accessibilityLabel={item.prompt}>
            {item.status === "pending" || !item.files[0] ? (
              <ActivityIndicator color={C.accentText} />
            ) : (
              <Image source={remoteImage(item.files[0].url, cookie)} style={StyleSheet.absoluteFill} contentFit="cover" transition={200} />
            )}
          </Pressable>
        )}
      />
      <Modal visible={shown !== null} transparent animationType="fade" onRequestClose={() => setShown(null)}>
        <SafeAreaView style={s.viewer}>
          <Pressable accessibilityRole="button" accessibilityLabel="Закрыть" onPress={() => { setShown(null); setSaved(null); }} style={s.viewerClose} hitSlop={10}>
            <Ionicons name="close" size={28} color={C.text} />
          </Pressable>
          {shown?.files[0] ? <Image source={remoteImage(shown.files[0].url, cookie)} style={{ flex: 1 }} contentFit="contain" /> : null}
          <Text numberOfLines={3} style={[ui.muted, { padding: 16 }]}>{shown?.prompt}</Text>
          {saved ? <Text style={[ui.muted, { textAlign: "center", color: C.success }]}>{saved}</Text> : null}
          <Button title="Сохранить в галерею" onPress={() => shown && void save(shown)} style={{ margin: 16 }} icon={<Ionicons name="download-outline" size={18} color={C.text} />} />
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  header: { height: 54, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: C.line },
  icon: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  ratio: { paddingHorizontal: 14, height: 36, borderRadius: 18, borderWidth: 1, borderColor: C.line, justifyContent: "center" },
  ratioOn: { backgroundColor: C.accentSoft, borderColor: "rgba(124,92,255,0.4)" },
  ratioText: { color: C.muted, fontSize: 14 },
  section: { color: C.faint, fontSize: 12, fontWeight: "700", letterSpacing: 1, textTransform: "uppercase", marginTop: 12 },
  tile: { borderRadius: 14, overflow: "hidden", backgroundColor: C.surface, alignItems: "center", justifyContent: "center" },
  viewer: { flex: 1, backgroundColor: "rgba(0,0,0,0.95)" },
  viewerClose: { alignSelf: "flex-end", padding: 16 },
});
