"use client";

import { useEffect, useRef } from "react";

/** Full-screen workbenches keep keyboard focus inside and return it on close. */
export function useWorkbenchPanel(full: boolean, onClose: () => void) {
  const panel = useRef<HTMLElement>(null);
  const close = useRef(onClose);
  useEffect(() => { close.current = onClose; }, [onClose]);
  useEffect(() => {
    const element = panel.current;
    if (!element) return;
    const previous = document.activeElement as HTMLElement | null;
    const overlay = () => full || !window.matchMedia("(min-width: 1024px)").matches;
    const controls = () => Array.from(element.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),a[href],[tabindex="0"]')).filter(e => e.getClientRects().length > 0);
    if (overlay()) element.querySelector<HTMLElement>('[data-workbench-close]')?.focus();
    const keydown = (event: KeyboardEvent) => {
      // Esc closes the panel when it covers the page (full screen, phones); beside the chat it's
      // part of the page, and an Esc while typing in the document shouldn't close it.
      if (event.key === "Escape" && !event.isComposing && overlay()) {
        event.preventDefault();
        event.stopPropagation();
        close.current();
      }
      if (event.key !== "Tab" || !overlay()) return;
      const items = controls();
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    element.addEventListener("keydown", keydown);
    return () => {
      element.removeEventListener("keydown", keydown);
      if (previous?.isConnected && (document.activeElement === document.body || element.contains(document.activeElement))) previous.focus();
    };
  }, [full]);
  return panel;
}
