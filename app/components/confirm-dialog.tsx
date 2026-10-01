"use client";
import { useEffect, useId, useRef } from "react";
export default function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const element = dialog.current;
    if (!open || !element) return;
    const previous =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    element.showModal();
    return () => {
      element.close();
      previous?.focus();
    };
  }, [open]);
  return (
    <dialog
      ref={dialog}
      className="confirm-dialog"
      aria-labelledby={id}
      aria-describedby={`${id}-description`}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onCancel();
      }}
    >
      <h2 id={id}>{title}</h2>
      <p id={`${id}-description`}>{description}</p>
      <div className="workflow-actions">
        <button
          type="button"
          className="button secondary"
          disabled={busy}
          onClick={onCancel}
        >
          Keep editing
        </button>
        <button
          type="button"
          className="button primary"
          disabled={busy}
          onClick={onConfirm}
        >
          {busy ? "Working…" : confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
