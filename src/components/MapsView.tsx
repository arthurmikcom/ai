"use client";

import "leaflet/dist/leaflet.css";
import type * as Leaflet from "leaflet";
import Image from "next/image";
import { useEffect, useRef, useState, type ComponentType } from "react";
import { api } from "@/lib/client/api";
import { findPlaces } from "@/lib/client/places";
import { categoriesFor } from "@/lib/places";
import { useStoredJson } from "@/lib/client/useStored";
import type { Place, PlaceCategory } from "@/lib/types";
import { useApp } from "./AppState";
import { PageHeading } from "./Design";
import mapboxLogo from "./assets/mapbox-logo.svg";
import { MapWelcome } from "./MapWelcome";
import {
  ArrowUp,
  Compass,
  MapIcon,
  Banknote,
  BedDouble,
  Camera,
  ChefHat,
  Clock,
  Coffee,
  ExternalLink,
  Fuel,
  Globe,
  Landmark,
  LoaderCircle,
  LocateFixed,
  MapPin,
  Navigation,
  Phone,
  Pill,
  Search,
  ShoppingCart,
  Sparkles,
  Trees,
  TriangleAlert,
  Utensils,
  Wine,
  X,
} from "./MaryxIcons";

interface Point {
  lat: number;
  lon: number;
  label: string;
}

interface Answer {
  question: string;
  answer: string;
  picks: { id: string; why: string }[];
  places: Place[];
  near: string | null;
}

const DEFAULT_POINT: Point = { lat: 55.7558, lon: 37.6173, label: "Москва, центр" };
const POINT_KEY = "maryx.maps.point";

const CATEGORIES: { id: PlaceCategory; label: string; Icon: ComponentType<{ className?: string }> }[] = [
  { id: "cafe", label: "Кафе", Icon: Coffee },
  { id: "restaurant", label: "Рестораны", Icon: Utensils },
  { id: "fast_food", label: "Фастфуд", Icon: ChefHat },
  { id: "bar", label: "Бары", Icon: Wine },
  { id: "park", label: "Парки", Icon: Trees },
  { id: "sight", label: "Что посмотреть", Icon: Camera },
  { id: "museum", label: "Музеи", Icon: Landmark },
  { id: "pharmacy", label: "Аптеки", Icon: Pill },
  { id: "supermarket", label: "Магазины", Icon: ShoppingCart },
  { id: "atm", label: "Банкоматы", Icon: Banknote },
  { id: "fuel", label: "АЗС", Icon: Fuel },
  { id: "hotel", label: "Отели", Icon: BedDouble },
];
const ICONS = Object.fromEntries(CATEGORIES.map((c) => [c.id, c.Icon])) as Record<PlaceCategory, ComponentType<{ className?: string }>>;

const IDEAS = [
  "Где выпить кофе рядом?",
  "Куда сходить с детьми?",
  "Аптека, которая работает сейчас",
  "Что посмотреть за час прогулки?",
  "Где вкусно поужинать?",
];

/** An admin's own tiles, or Mapbox with its public token (both set at build time, never in the source). */
const CUSTOM_TILES = process.env.NEXT_PUBLIC_MAP_TILES;
const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
/** CARTO's dark and light maps need the site's free key since 2026 (NEXT_PUBLIC_CARTO_KEY, from carto.com/basemaps/apikey). */
const CARTO_KEY = process.env.NEXT_PUBLIC_CARTO_KEY;
const MAP_PROVIDER = CUSTOM_TILES ? "custom" : MAPBOX_TOKEN ? "mapbox" : CARTO_KEY ? "carto" : "osm";
/**
 * Without any of them: OpenStreetMap's own tiles (no key), darkened in the
 * dark theme; when they don't answer, a mirror of them.
 */
const OSM_TILES = ["https://tile.openstreetmap.org/{z}/{x}/{y}.png", "https://tile.openstreetmap.de/{z}/{x}/{y}.png"];
const ATTRIBUTION = `${MAP_PROVIDER === "mapbox" ? '&copy; <a href="https://www.mapbox.com/about/maps/">Mapbox</a> ' : ""}&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>${MAP_PROVIDER === "carto" ? ' &copy; <a href="https://carto.com/attributions">CARTO</a>' : ""}`;

const lightTheme = () => document.documentElement.dataset.theme === "light";

function tileUrl(mirror = 0): string {
  const light = lightTheme();
  if (CUSTOM_TILES) return CUSTOM_TILES;
  if (MAPBOX_TOKEN) {
    return `https://api.mapbox.com/styles/v1/mapbox/${light ? "light-v11" : "dark-v11"}/tiles/256/{z}/{x}/{y}{r}?access_token=${encodeURIComponent(MAPBOX_TOKEN)}`;
  }
  if (CARTO_KEY) {
    return `https://basemaps.cartocdn.com/${light ? "rastertiles/voyager" : "dark_all"}/{z}/{x}/{y}{r}.png?key=${encodeURIComponent(CARTO_KEY)}`;
  }
  return OSM_TILES[Math.min(mirror, OSM_TILES.length - 1)];
}

/** "350 м", "1,2 км". */
function distanceText(metres: number): string {
  return metres < 1000 ? `${Math.round(metres / 10) * 10} м` : `${(metres / 1000).toFixed(1).replace(".", ",")} км`;
}

/** OpenStreetMap's "Mo-Fr 08:00-22:00" in Russian. */
function hoursText(hours: string): string {
  const days: Record<string, string> = { Mo: "Пн", Tu: "Вт", We: "Ср", Th: "Чт", Fr: "Пт", Sa: "Сб", Su: "Вс", PH: "праздники" };
  if (hours.trim() === "24/7") return "Круглосуточно";
  return hours
    .replace(/\b(Mo|Tu|We|Th|Fr|Sa|Su|PH)\b/g, (d) => days[d])
    .replace(/\boff\b/g, "выходной")
    .replace(/;\s*/g, "; ");
}

/** "1 место", "3 места", "12 мест". */
function placesText(n: number): string {
  const tens = n % 100;
  const last = n % 10;
  const word = tens >= 11 && tens <= 14 ? "мест" : last === 1 ? "место" : last >= 2 && last <= 4 ? "места" : "мест";
  return `${n} ${word}`;
}

/** Only real web links: the data comes from OpenStreetMap, anyone can edit it. */
function websiteOf(site: string | undefined): string | null {
  if (!site) return null;
  const url = /^https?:\/\//i.test(site) ? site : `https://${site}`;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.href : null;
  } catch {
    return null;
  }
}

function telOf(phone: string | undefined): string | null {
  const first = phone?.split(";")[0].trim();
  return first && /^[+\d][\d\s()-]{4,}$/.test(first) ? first.replace(/[^\d+]/g, "") : null;
}

/** Metres between two points, to know the map has moved away. */
function apart(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const rad = Math.PI / 180;
  const x = (b.lon - a.lon) * rad * Math.cos(((a.lat + b.lat) / 2) * rad);
  const y = (b.lat - a.lat) * rad;
  return Math.sqrt(x * x + y * y) * 6_371_000;
}

interface MapParts {
  L: typeof Leaflet;
  map: Leaflet.Map;
  tiles: Leaflet.TileLayer;
  pins: Leaflet.LayerGroup;
  here: Leaflet.Marker;
  markers: Map<string, Leaflet.Marker>;
  /** The map is being moved by the page, not by the user. */
  quiet: boolean;
}

/**
 * «Карты» (like ChatGPT's Maps): real places around you or any address from
 * OpenStreetMap on a map, and MARYX to ask "where to go" — it picks from
 * those places only and says why.
 */
export function MapsView() {
  const app = useApp();
  const [stored, setStored] = useStoredJson<Point>(POINT_KEY);
  const point = stored ?? DEFAULT_POINT;
  const [categories, setCategories] = useState<PlaceCategory[]>(["cafe"]);
  const [result, setResult] = useState<{ key: string; places: Place[]; near: string | null; error?: string } | null>(null);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [address, setAddress] = useState("");
  const [finding, setFinding] = useState<"address" | "me" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drift, setDrift] = useState<{ lat: number; lon: number } | null>(null);
  const [ready, setReady] = useState(false);
  const [tilesFailed, setTilesFailed] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const addressInput = useRef<HTMLInputElement>(null);
  const parts = useRef<MapParts | null>(null);
  const list = useRef<HTMLUListElement>(null);

  const key = `${point.lat},${point.lon}:${categories.join(",")}`;
  const loading = !answer && result?.key !== key;
  const places = answer ? answer.places : result?.key === key ? result.places : [];
  const near = answer?.near ?? (result?.key === key ? result.near : null);
  const picks = answer?.picks ?? [];
  const pickOf = (id: string) => picks.findIndex((p) => p.id === id);
  // MARYX's picks first, in its order; then everything else nearest first.
  const ordered = [
    ...picks.map((p) => places.find((x) => x.id === p.id)).filter((p): p is Place => Boolean(p)),
    ...places.filter((p) => pickOf(p.id) < 0),
  ];

  const moveTo = (next: Point) => {
    setStored(next);
    setAnswer(null);
    setSelected(null);
    setDrift(null);
  };

  // The places around the point, whenever the point or the kinds change.
  useEffect(() => {
    if (answer) return;
    let alive = true;
    const [at, kinds] = key.split(":");
    const [lat, lon] = at.split(",");
    findPlaces(Number(lat), Number(lon), kinds.split(",") as PlaceCategory[]).then(
      (got) => alive && setResult({ key, ...got }),
      (e) => alive && setResult({ key, places: [], near: null, error: e instanceof Error ? e.message : String(e) }),
    );
    return () => {
      alive = false;
    };
  }, [key, answer]);

  // The map itself: Leaflet only runs in the browser, so it's loaded here.
  useEffect(() => {
    let alive = true;
    let observer: MutationObserver | undefined;
    void import("leaflet").then(({ default: L }) => {
      if (!alive || !box.current) return;
      const map = L.map(box.current, { zoomControl: false }).setView([DEFAULT_POINT.lat, DEFAULT_POINT.lon], 15);
      L.control.zoom({ position: "bottomright", zoomInTitle: "Приблизить", zoomOutTitle: "Отдалить" }).addTo(map);
      map.attributionControl.setPrefix(false);
      let loadedTiles = false;
      let mirror = 0;
      const tiles = L.tileLayer(tileUrl(), { attribution: ATTRIBUTION, subdomains: "abcd", maxZoom: 19 });
      tiles.on("tileload", () => { loadedTiles = true; setTilesFailed(false); });
      tiles.on("tileerror", () => {
        if (loadedTiles) return;
        // OpenStreetMap's tiles not answering: its mirror, then a notice.
        if (MAP_PROVIDER === "osm" && mirror < OSM_TILES.length - 1) tiles.setUrl(tileUrl(++mirror));
        else setTilesFailed(true);
      });
      tiles.addTo(map);
      // OpenStreetMap's tiles are light only: the dark theme darkens them.
      const shade = () => tiles.getContainer()?.classList.toggle("map-tiles-dark", MAP_PROVIDER === "osm" && !lightTheme());
      shade();
      // The map follows the site's light or dark look.
      observer = new MutationObserver(() => { loadedTiles = false; setTilesFailed(false); shade(); tiles.setUrl(tileUrl(mirror)); });
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
      const here = L.marker([DEFAULT_POINT.lat, DEFAULT_POINT.lon], {
        icon: L.divIcon({ className: "maryx-here", html: "<span></span>", iconSize: [22, 22], iconAnchor: [11, 11] }),
        keyboard: false,
        interactive: false,
        zIndexOffset: -1000,
      }).addTo(map);
      const pins = L.layerGroup().addTo(map);
      // Moved by hand far from the point: offer to search there.
      map.on("moveend", () => {
        const c = map.getCenter();
        setDrift(parts.current?.quiet ? null : { lat: c.lat, lon: c.lng });
      });
      parts.current = { L, map, tiles, pins, here, markers: new Map(), quiet: false };
      setReady(true);
    });
    return () => {
      alive = false;
      observer?.disconnect();
      parts.current?.map.remove();
      parts.current = null;
    };
  }, []);

  // The point: the map goes there.
  useEffect(() => {
    const p = parts.current;
    if (!ready || !p) return;
    p.here.setLatLng([point.lat, point.lon]);
    p.quiet = true;
    p.map.setView([point.lat, point.lon], Math.max(p.map.getZoom(), 15), { animate: false });
    p.quiet = false;
  }, [ready, point.lat, point.lon]);

  // The pins: MARYX's picks numbered, the rest as dots; the map shows them all.
  const pinKey = `${ordered.map((p) => p.id).join(",")}|${picks.map((p) => p.id).join(",")}`;
  useEffect(() => {
    const p = parts.current;
    if (!ready || !p) return;
    p.pins.clearLayers();
    p.markers.clear();
    for (const place of ordered) {
      const n = pickOf(place.id);
      const icon = p.L.divIcon({
        className: "maryx-pin-wrap",
        html: `<span class="maryx-pin${n >= 0 ? " is-pick" : ""}">${n >= 0 ? n + 1 : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M12 21S5 15 5 10a7 7 0 0 1 14 0c0 5-7 11-7 11Z"/><circle cx="12" cy="10" r="2.5"/></svg>'}</span>`,
        iconSize: [34, 34],
        iconAnchor: [17, 17],
      });
      const marker = p.L.marker([place.lat, place.lon], { icon, title: place.name, alt: place.name, zIndexOffset: n >= 0 ? 500 - n : 0 })
        .on("click", () => setSelected(place.id))
        .addTo(p.pins);
      const label = document.createElement("span");
      label.textContent = place.name;
      marker.bindTooltip(label, { direction: "top", offset: [0, -18], className: "maryx-map-tooltip" });
      p.markers.set(place.id, marker);
    }
    const shown = picks.length ? ordered.slice(0, picks.length) : ordered.slice(0, 12);
    if (shown.length) {
      const bounds = p.L.latLngBounds([[point.lat, point.lon], ...shown.map((x) => [x.lat, x.lon] as [number, number])]);
      p.quiet = true;
      p.map.fitBounds(bounds, { padding: [48, 48], maxZoom: 16, animate: false });
      p.quiet = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- pinKey stands for the places and picks.
  }, [ready, pinKey]);

  // The chosen place stands out on the map and in the list.
  useEffect(() => {
    const p = parts.current;
    if (!ready || !p) return;
    for (const [id, marker] of p.markers) {
      marker.getElement()?.querySelector(".maryx-pin")?.classList.toggle("is-active", id === selected);
      if (id === selected) {
        marker.setZIndexOffset(1000);
        if (!p.map.getBounds().contains(marker.getLatLng())) p.map.panTo(marker.getLatLng());
      }
    }
    if (selected) list.current?.querySelector(`[data-place="${selected}"]`)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [ready, selected, pinKey]);

  const toggle = (id: PlaceCategory) => {
    setAnswer(null);
    setSelected(null);
    setCategories((list) => (list.includes(id) ? (list.length > 1 ? list.filter((c) => c !== id) : list) : [...list, id]));
  };

  const findAddress = async () => {
    const q = address.trim();
    if (q.length < 2 || finding) return;
    setFinding("address");
    setError(null);
    try {
      const found = await api<{ lat: number; lon: number; label: string }>(`/api/maps/search?q=${encodeURIComponent(q)}`);
      moveTo(found);
      setAddress("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setFinding(null);
  };

  const findMe = () => {
    if (!navigator.geolocation) {
      setError("Браузер не умеет определять место — введите адрес или город.");
      return;
    }
    setFinding("me");
    setError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        moveTo({ lat: pos.coords.latitude, lon: pos.coords.longitude, label: "Вы здесь" });
        setFinding(null);
      },
      () => {
        setError("Не получилось определить, где вы. Разрешите доступ к геопозиции или введите адрес.");
        setFinding(null);
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 },
    );
  };

  const ask = async (text = question) => {
    const q = text.trim();
    if (q.length < 2 || asking) return;
    setQuestion(q);
    setAsking(true);
    setError(null);
    try {
      // The places for the question, found from here (a walk away; farther when there are few).
      const kinds = categoriesFor(q);
      const around = await findPlaces(point.lat, point.lon, kinds)
        .then((r) => (r.places.length >= 3 ? r : findPlaces(point.lat, point.lon, kinds, 4000)))
        .catch(() => null);
      const got = await api<Omit<Answer, "question"> & { categories: PlaceCategory[] }>("/api/maps/ask", {
        method: "POST",
        body: JSON.stringify({
          question: q,
          lat: point.lat,
          lon: point.lon,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          ...(around ? { places: around.places, near: around.near } : {}),
        }),
      });
      setAnswer({ question: q, answer: got.answer, picks: got.picks, places: got.places, near: got.near });
      if (got.categories.length) setCategories(got.categories);
      setSelected(got.picks[0]?.id ?? null);
      setQuestion("");
      app.refreshMe();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setAsking(false);
  };

  const moved = drift !== null && apart(drift, point) > 300;
  const where = near || point.label;

  return (
    <div className="h-full overflow-y-auto">
      <div className="page-content maps-page">
        <PageHeading
          number="08"
          eyebrow="Маленькие планы. Большие открытия"
          title="Откройте своё рядом."
          description="Найдите любимое кафе, тихий парк или маршрут на выходные. Настоящие места на карте и рекомендации MARYX — в одном пространстве."
        ><div className="section-status"><MapIcon size={16} /><span>Смотреть карту — бесплатно</span></div></PageHeading>
        <MapWelcome onLocate={findMe} onManual={() => addressInput.current?.focus()} />

        <section className="map-discovery" aria-label="Помощь MARYX в поиске мест">
        <div className="map-discovery-label"><span className="section-symbol"><Compass size={20} /></span><div><h2>Куда отправимся?</h2><p>Опишите планы — MARYX подберёт места</p></div></div>
        <form
          className="composer-panel map-ask-form"
          onSubmit={(e) => {
            e.preventDefault();
            void ask();
          }}
        >
          <Sparkles className="size-5 shrink-0 text-violet-300" />
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            maxLength={500}
            placeholder="Спросите MARYX, что рядом: где выпить кофе, куда сходить с детьми…"
            aria-label="Спросите MARYX, что рядом"
            className="min-w-0 flex-1 bg-transparent py-2 text-[15px] text-zinc-100 outline-none placeholder:text-zinc-500"
          />
          <button type="submit" disabled={question.trim().length < 2 || asking} aria-label="Спросить" className="maryx-button flex size-10 shrink-0 items-center justify-center rounded-2xl">
            {asking ? <LoaderCircle className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}
          </button>
        </form>
        {!answer && (
          <div className="map-ideas">
            {IDEAS.map((idea) => (
              <button
                key={idea}
                type="button"
                disabled={asking}
                onClick={() => void ask(idea)}
                className="map-idea"
              >
                {idea}
              </button>
            ))}
          </div>
        )}

        </section>
        <div className="map-location-controls">
          <form
            className="map-address-form"
            onSubmit={(e) => {
              e.preventDefault();
              void findAddress();
            }}
          >
            <Search className="size-4 shrink-0 text-zinc-500" />
            <input
              ref={addressInput}
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              maxLength={200}
              placeholder="Город, адрес или место"
              aria-label="Город, адрес или место"
              className="min-w-0 flex-1 bg-transparent py-1.5 text-sm text-zinc-100 outline-none placeholder:text-zinc-500"
            />
            <button type="submit" disabled={address.trim().length < 2 || finding !== null} className="rounded-xl px-3 py-1.5 text-xs text-zinc-200 hover:bg-white/10 disabled:opacity-40">
              {finding === "address" ? <LoaderCircle className="size-4 animate-spin" /> : "Найти"}
            </button>
          </form>
          <button
            type="button"
            onClick={findMe}
            disabled={finding !== null}
            className="map-locate-button"
          >
            {finding === "me" ? <LoaderCircle className="size-4 animate-spin" /> : <LocateFixed className="size-4 text-violet-300" />}
            Где я
          </button>
        </div>
        <div role="group" aria-label="Что искать" className="map-categories">
          {CATEGORIES.map(({ id, label, Icon }) => {
            const on = categories.includes(id);
            return (
              <button
                key={id}
                type="button"
                aria-pressed={on}
                onClick={() => toggle(id)}
                className="map-category"
                data-category={id}
              >
                <span className="map-category-symbol"><Icon className="size-4" /></span>
                <span>{label}</span>
              </button>
            );
          })}
        </div>
        {error && (
          <p role="alert" className="section-error">
            <TriangleAlert className="size-4 shrink-0" /> {error}
          </p>
        )}

        <div className="map-results-grid">
          <div className="maps-canvas" data-map-provider={MAP_PROVIDER}>
            <div ref={box} className="absolute inset-0" role="region" aria-label="Карта" />
            {MAP_PROVIDER === "mapbox" && <a className="mapbox-brand" href="https://www.mapbox.com/about/maps/" target="_blank" rel="noopener noreferrer" aria-label="Карты Mapbox"><Image src={mapboxLogo} width={88} height={23} alt="Mapbox" unoptimized /></a>}
            <div className="map-location-badge"><span className="map-live-dot" /><span>{where}</span></div>
            {tilesFailed && <div className="map-tiles-notice" role="status"><MapIcon size={18} /><div><strong>Подложка карты недоступна</strong><p>Места и маршруты по-прежнему доступны.</p><button type="button" onClick={() => { setTilesFailed(false); parts.current?.tiles.redraw(); }}>Повторить загрузку</button></div></div>}
            {!ready && (
              <div className="absolute inset-0 flex items-center justify-center">
                <LoaderCircle className="size-6 animate-spin text-zinc-500" />
              </div>
            )}
            {moved && drift && (
              <button
                type="button"
                onClick={() => moveTo({ lat: Math.round(drift.lat * 10_000) / 10_000, lon: Math.round(drift.lon * 10_000) / 10_000, label: "Точка на карте" })}
                className="maryx-button absolute left-1/2 top-3 z-[500] flex -translate-x-1/2 items-center gap-2 rounded-full px-4 py-2 text-xs"
              >
                <Search className="size-3.5" /> Искать здесь
              </button>
            )}
          </div>

          <div className="map-places-panel">
            <div className="map-places-heading">
              <MapPin className="size-4 shrink-0 text-violet-300" />
              <div className="min-w-0 flex-1"><h2>Места рядом</h2><p title={where}>{where}</p></div>
              <span className="map-count" aria-live="polite">{loading ? "Поиск…" : placesText(places.length)}</span>
            </div>

            {answer && (
              <div className="map-answer">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="map-answer-label"><Sparkles size={13} />Выбор MARYX</div>
                    <div className="text-xs text-violet-200/80">{answer.question}</div>
                    <p className="mt-1.5 text-sm leading-6 text-zinc-100">{answer.answer}</p>
                  </div>
                  <button type="button" onClick={() => setAnswer(null)} aria-label="Закрыть ответ" className="rounded-lg p-1 text-zinc-400 hover:bg-white/10 hover:text-zinc-100">
                    <X className="size-4" />
                  </button>
                </div>
              </div>
            )}

            <ul ref={list} aria-label="Места рядом" className="map-places-list">
              {loading && (
                <li className="flex justify-center p-8">
                  <LoaderCircle className="size-5 animate-spin text-zinc-500" />
                </li>
              )}
              {!loading && result?.error && !answer && <li className="p-6 text-center text-sm text-amber-300">{result.error}</li>}
              {!loading && !result?.error && !places.length && !answer && (
                <li className="section-empty">
                  <MapPin className="size-7 text-zinc-500" />
                  <p className="text-sm text-zinc-300">Рядом ничего не нашлось</p>
                  <p className="text-xs text-zinc-500">Выберите другое место на карте или другие категории.</p>
                </li>
              )}
              {ordered.map((place) => {
                const n = pickOf(place.id);
                const Icon = ICONS[place.category] ?? MapPin;
                const site = websiteOf(place.website);
                const tel = telOf(place.phone);
                const active = selected === place.id;
                return (
                  <li
                    key={place.id}
                    data-place={place.id}
                    className="map-place-card"
                    data-active={active || undefined}
                    data-category={place.category}
                  >
                    <button type="button" onClick={() => setSelected(place.id)} className="flex w-full items-start gap-3 text-left" aria-current={active || undefined}>
                      <span
                        className={`map-place-symbol ${n >= 0 ? "is-pick" : ""}`}
                      >
                        {n >= 0 ? n + 1 : <Icon className="size-4" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[15px] font-medium text-zinc-100">{place.name}</span>
                        <span className="map-place-meta"><span>{place.kind}</span><span><Navigation size={11} />{distanceText(place.distance)}</span></span>
                      </span>
                    </button>
                    {n >= 0 && picks[n].why && <p className="ml-12 mt-1.5 text-[13px] leading-5 text-violet-100/90">{picks[n].why}</p>}
                    {(place.address || place.hours) && (
                      <div className="ml-12 mt-1.5 space-y-0.5 text-xs text-zinc-500">
                        {place.address && <div className="truncate">{place.address}</div>}
                        {place.hours && (
                          <div className="flex items-start gap-1">
                            <Clock className="mt-0.5 size-3 shrink-0" />
                            <span className="line-clamp-2">{hoursText(place.hours)}</span>
                          </div>
                        )}
                      </div>
                    )}
                    {active && (
                      <div className="map-place-actions">
                        <a
                          href={`https://www.google.com/maps/dir/?api=1&destination=${place.lat},${place.lon}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="maryx-button flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs"
                        >
                          <Navigation className="size-3.5" /> Маршрут
                        </a>
                        <a
                          href={`https://yandex.ru/maps/?rtext=~${place.lat},${place.lon}&rtt=auto`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-zinc-200 hover:bg-white/5"
                        >
                          <ExternalLink className="size-3.5" /> Яндекс Карты
                        </a>
                        {tel && (
                          <a href={`tel:${tel}`} className="flex items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-zinc-200 hover:bg-white/5">
                            <Phone className="size-3.5" /> Позвонить
                          </a>
                        )}
                        {site && (
                          <a href={site} target="_blank" rel="noopener noreferrer nofollow" className="flex items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-zinc-200 hover:bg-white/5">
                            <Globe className="size-3.5" /> Сайт
                          </a>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
        <p className="section-footnote">
          Места — из OpenStreetMap: часы работы и телефоны могут устареть, перед поездкой лучше уточнить. Вопрос к MARYX считается
          одним сообщением; просто смотреть карту — бесплатно.
        </p>
      </div>
    </div>
  );
}
