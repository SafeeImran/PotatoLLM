import { useCallback, useEffect, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";

interface ResizableWidthOptions {
  min: number;
  max: number;
  /** Used only the first time — once a width is stored, it wins over this. */
  defaultWidth: number;
  storageKey: string;
  /** Which edge the user drags. "right" is a left-docked panel (the
   * sidebar) — dragging right grows it. "left" is a right-docked panel (the
   * live monitor) — dragging left grows it. */
  edge: "left" | "right";
}

/**
 * Drag-to-resize for a single panel, backed by localStorage. Plain component
 * state (not the shared-store pattern usePotatoTheme/useAppearance use) is
 * correct here: the sidebar and the live monitor each mount exactly once, so
 * there's no second instance that could read a stale value.
 */
export function useResizableWidth({ min, max, defaultWidth, storageKey, edge }: ResizableWidthOptions) {
  const [width, setWidth] = useState<number>(() => {
    try {
      const stored = Number(localStorage.getItem(storageKey));
      if (Number.isFinite(stored) && stored > 0) return Math.min(max, Math.max(min, stored));
    } catch {
      // Private-mode / storage-disabled: fall through to the default.
    }
    return defaultWidth;
  });
  const [dragging, setDragging] = useState(false);
  // The drag gesture computes from where it started, not by re-reading
  // `width` on every mousemove — re-reading would compound the previous
  // move's rounding/clamping into the next one over a long drag.
  const startRef = useRef({ clientX: 0, width });

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, String(Math.round(width)));
    } catch {
      // Preference just doesn't persist; the session still sizes correctly.
    }
  }, [width, storageKey]);

  const startDrag = useCallback(
    (event: ReactMouseEvent) => {
      event.preventDefault();
      startRef.current = { clientX: event.clientX, width };
      setDragging(true);

      function onMove(e: MouseEvent) {
        const delta = e.clientX - startRef.current.clientX;
        const signed = edge === "right" ? delta : -delta;
        setWidth(Math.min(max, Math.max(min, startRef.current.width + signed)));
      }
      function onUp() {
        setDragging(false);
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      }
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [width, min, max, edge],
  );

  // A body-level cursor/selection lock while dragging — without it, a fast
  // drag that briefly outruns the panel edge shows the text cursor and can
  // select the page's own text instead of just resizing.
  useEffect(() => {
    if (!dragging) return;
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "ew-resize";
    document.body.style.userSelect = "none";
    return () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
    };
  }, [dragging]);

  return { width, startDrag, dragging };
}
