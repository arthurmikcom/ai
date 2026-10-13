// Browser-side storage. Everything lives in IndexedDB, which holds far more
// than localStorage and can store generated images and videos as Blobs.

import { clear, createStore, del, set, values, type UseStore } from "idb-keyval";
import type { Assistant, Chat, MediaItem } from "@/lib/types";

let stores: { chats: UseStore; assistants: UseStore; media: UseStore } | null = null;

function db() {
  stores ??= {
    chats: createStore("nexus-chats", "chats"),
    assistants: createStore("nexus-assistants", "assistants"),
    media: createStore("nexus-media", "media"),
  };
  return stores;
}

function table<T extends { id: string }>(pick: () => UseStore) {
  return {
    all: () => values<T>(pick()),
    put: (item: T) => set(item.id, item, pick()),
    remove: (id: string) => del(id, pick()),
    clear: () => clear(pick()),
  };
}

export const chatDB = table<Chat>(() => db().chats);
export const assistantDB = table<Assistant>(() => db().assistants);
export const mediaDB = table<MediaItem>(() => db().media);
