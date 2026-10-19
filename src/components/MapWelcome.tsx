"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { useStoredJson } from "@/lib/client/useStored";
import { Coffee, LocateFixed, MapIcon, MapPin, Trees, X } from "./MaryxIcons";

const noSubscribe = () => () => {};

/** Location is requested only after the person chooses the location button. */
export function MapWelcome({ onLocate, onManual }: { onLocate: () => void; onManual: () => void }) {
  const [dismissed, setDismissed] = useStoredJson<boolean>("maryx.maps.welcome");
  const hydrated = useSyncExternalStore(noSubscribe, () => true, () => false);
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const node = dialog.current;
    if (!node || !hydrated) return;
    if (!dismissed && !node.open) {
      node.showModal();
      node.querySelector<HTMLButtonElement>("[data-locate]")?.focus();
    } else if (dismissed && node.open) node.close();
    return () => { if (node.open) node.close(); };
  }, [dismissed, hydrated]);

  const dismiss = () => {
    dialog.current?.close();
    setDismissed(true);
  };

  return (
    <dialog ref={dialog} className="map-welcome" aria-labelledby="map-welcome-title" aria-describedby="map-welcome-description" onCancel={dismiss}>
      <button type="button" onClick={dismiss} className="workspace-icon-button map-welcome-close" aria-label="Закрыть знакомство с картами"><X size={19} /></button>
      <div className="map-welcome-art" aria-hidden="true">
        <div className="map-welcome-grid" />
        <span className="welcome-place welcome-place-coffee"><Coffee size={22} /></span>
        <span className="welcome-place welcome-place-park"><Trees size={23} /></span>
        <span className="welcome-place welcome-place-pin"><MapPin size={20} /></span>
        <span className="welcome-location"><LocateFixed size={31} /></span>
      </div>
      <div className="section-kicker">Карты MARYX</div>
      <h2 id="map-welcome-title">Рядом больше,<br /><span>чем кажется.</span></h2>
      <p id="map-welcome-description">Уютное кафе за углом, новый маршрут или планы на вечер. Разрешите доступ к геолокации — MARYX поможет найти своё рядом.</p>
      <div className="map-welcome-actions">
        <button type="button" data-locate onClick={() => { dismiss(); onLocate(); }} className="maryx-button"><LocateFixed size={18} />Использовать моё местоположение</button>
        <button type="button" onClick={() => { dismiss(); onManual(); }}><MapIcon size={17} />Выбрать город вручную</button>
      </div>
      <small>Доступ к геолокации можно отключить в настройках браузера.</small>
    </dialog>
  );
}
