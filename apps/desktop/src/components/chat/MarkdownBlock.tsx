import { Suspense, lazy } from "react";

/**
 * Lazy boundary around the Markdown renderer.
 *
 * react-markdown, KaTeX and the highlight.js grammars together are ~650 KB —
 * more than the rest of the app combined, and none of it is needed to paint an
 * empty Playground. Splitting it out keeps startup light; the fallback renders
 * the same text verbatim, so a slow chunk shows unstyled output rather than a
 * blank turn.
 */
const Markdown = lazy(() => import("./Markdown"));

export function MarkdownBlock({ children }: { children: string }) {
  return (
    <Suspense
      fallback={
        <div style={{ fontSize: 14, lineHeight: 1.62, color: "var(--pot-ink-soft)", whiteSpace: "pre-wrap" }}>
          {children}
        </div>
      }
    >
      <Markdown>{children}</Markdown>
    </Suspense>
  );
}
