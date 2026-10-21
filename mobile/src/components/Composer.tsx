import Ionicons from "@expo/vector-icons/Ionicons";
import { Image } from "expo-image";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import type { Picked } from "@/lib/chats";
import { C } from "@/lib/theme";
import { useAskToSignIn } from "./ui";

const MAX_PHOTOS = 4;

/** A photo, made smaller (the long side 1600 px) so it goes quickly: what the site does too. */
async function shrink(asset: ImagePicker.ImagePickerAsset): Promise<Picked> {
  const big = Math.max(asset.width, asset.height);
  const ctx = ImageManipulator.manipulate(asset.uri);
  if (big > 1600) ctx.resize(asset.width >= asset.height ? { width: 1600 } : { height: 1600 });
  const image = await ctx.renderAsync();
  const out = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.75, base64: true });
  return { uri: out.uri, mime: "image/jpeg", data: out.base64 ?? "", name: asset.fileName ?? "photo.jpg" };
}

export function Composer({
  guest,
  streaming,
  onSend,
  onStop,
}: {
  guest: boolean;
  streaming: boolean;
  onSend: (text: string, opts: { photos?: Picked[]; image?: boolean }) => void;
  onStop: () => void;
}) {
  const ask = useAskToSignIn();
  const [text, setText] = useState("");
  const [photos, setPhotos] = useState<Picked[]>([]);
  const [drawing, setDrawing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pick = async (camera: boolean) => {
    if (guest) return ask("прикреплять фото");
    setError(null);
    try {
      if (camera) {
        const { granted } = await ImagePicker.requestCameraPermissionsAsync();
        if (!granted) return setError("Нет доступа к камере — разрешите его в настройках телефона.");
      }
      const options: ImagePicker.ImagePickerOptions = { mediaTypes: ["images"], quality: 1, allowsMultipleSelection: !camera, selectionLimit: MAX_PHOTOS - photos.length };
      const result = camera ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
      if (result.canceled) return;
      const added = await Promise.all(result.assets.slice(0, MAX_PHOTOS - photos.length).map(shrink));
      setPhotos((list) => [...list, ...added].slice(0, MAX_PHOTOS));
    } catch {
      setError("Не удалось открыть фото. Попробуйте другое.");
    }
  };

  const submit = () => {
    const value = text.trim();
    if (!value && !photos.length) return;
    onSend(value, { photos: photos.length ? photos : undefined, image: drawing || undefined });
    setText("");
    setPhotos([]);
    setDrawing(false);
  };

  const canSend = Boolean(text.trim() || photos.length);
  return (
    <View style={s.wrap}>
      {photos.length > 0 && (
        <View style={s.photos}>
          {photos.map((p, i) => (
            <View key={p.uri}>
              <Image source={{ uri: p.uri }} style={s.photo} contentFit="cover" />
              <Pressable accessibilityLabel="Убрать фото" onPress={() => setPhotos((list) => list.filter((_, j) => j !== i))} style={s.remove} hitSlop={6}>
                <Ionicons name="close" size={14} color={C.text} />
              </Pressable>
            </View>
          ))}
        </View>
      )}
      {error ? <Text style={s.error}>{error}</Text> : null}
      <TextInput
        value={text}
        onChangeText={setText}
        placeholder={drawing ? "Опишите картинку…" : "Спросите что угодно…"}
        placeholderTextColor={C.faint}
        multiline
        accessibilityLabel="Сообщение"
        style={s.input}
        onSubmitEditing={submit}
        submitBehavior="newline"
      />
      <View style={s.row}>
        <Pressable accessibilityLabel="Прикрепить фото" onPress={() => void pick(false)} style={s.tool} hitSlop={6}>
          <Ionicons name="image-outline" size={22} color={C.muted} />
        </Pressable>
        <Pressable accessibilityLabel="Сфотографировать" onPress={() => void pick(true)} style={s.tool} hitSlop={6}>
          <Ionicons name="camera-outline" size={22} color={C.muted} />
        </Pressable>
        <Pressable
          accessibilityLabel="Картинка"
          accessibilityState={{ selected: drawing }}
          onPress={() => (guest ? ask("создавать картинки") : setDrawing((d) => !d))}
          style={[s.pill, drawing && s.pillOn]}
        >
          <Ionicons name="color-palette-outline" size={17} color={drawing ? C.accentText : C.muted} />
          <Text style={[s.pillText, drawing && { color: C.accentText }]}>Картинка</Text>
        </Pressable>
        <View style={{ flex: 1 }} />
        {streaming ? (
          <Pressable accessibilityLabel="Остановить" onPress={onStop} style={[s.send, { backgroundColor: C.text }]}>
            <Ionicons name="stop" size={16} color={C.bg} />
          </Pressable>
        ) : (
          <Pressable accessibilityLabel="Отправить" onPress={submit} disabled={!canSend} style={[s.send, !canSend && { opacity: 0.35 }]}>
            <Ionicons name="arrow-up" size={20} color={C.text} />
          </Pressable>
        )}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { backgroundColor: C.surface, borderColor: C.lineStrong, borderWidth: 1, borderRadius: 24, paddingHorizontal: 12, paddingTop: 10, paddingBottom: 8, gap: 6 },
  input: { color: C.text, fontSize: 16, lineHeight: 22, maxHeight: 140, minHeight: 26, paddingHorizontal: 4, paddingVertical: 4 },
  row: { flexDirection: "row", alignItems: "center", gap: 4 },
  tool: { width: 38, height: 38, alignItems: "center", justifyContent: "center", borderRadius: 19 },
  pill: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, height: 34, borderRadius: 17, marginLeft: 2 },
  pillOn: { backgroundColor: C.accentSoft },
  pillText: { color: C.muted, fontSize: 14 },
  send: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center", backgroundColor: C.accent },
  photos: { flexDirection: "row", gap: 8, paddingBottom: 4 },
  photo: { width: 64, height: 64, borderRadius: 12 },
  remove: { position: "absolute", top: -6, right: -6, width: 22, height: 22, borderRadius: 11, backgroundColor: "#000", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: C.lineStrong },
  error: { color: C.danger, fontSize: 13 },
});
