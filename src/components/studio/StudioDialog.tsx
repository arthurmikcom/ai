"use client";

import { useEffect, useRef, type ReactNode } from "react";

/** Native modal focus containment and return to the control that opened it. */
export function StudioDialog({ title, className, onClose, children }: { title: string; className: string; onClose: () => void; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const node = dialog.current;
    node?.showModal();
    return () => { if (node?.open) node.close(); };
  }, []);
  return (
    <dialog ref={dialog} aria-label={title} className={`studio-dialog ${className}`} onCancel={(e) => { e.preventDefault(); onClose(); }} onClick={(e) => {
      if (e.target !== e.currentTarget) return;
      const box = e.currentTarget.getBoundingClientRect();
      if (e.clientX < box.left || e.clientX > box.right || e.clientY < box.top || e.clientY > box.bottom) onClose();
    }}>
      {children}
    </dialog>
  );
}
