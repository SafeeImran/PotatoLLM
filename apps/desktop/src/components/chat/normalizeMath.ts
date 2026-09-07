/**
 * Reconciles the LaTeX delimiters models actually emit with the ones
 * remark-math understands.
 *
 * remark-math only knows `$…$` and `$…$` on its own lines. Instruction-tuned
 * models routinely emit LaTeX's own `\(…\)` and `\[…\]` instead, and very often
 * put a whole display equation on a single `$$…$$` line — which remark-math
 * reads as *inline* math, so a centred derivation ends up squeezed into the
 * paragraph. All three cases are rewritten here before parsing.
 *
 * Code is left strictly alone: a fence or a code span may legitimately contain
 * `\[`, and rewriting it would corrupt the snippet.
 */

/** Fenced blocks and code spans, captured so `split` keeps them as odd entries. */
const CODE_SEGMENT = /(```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)|`[^`\n]*`)/g;

function rewrite(text: string): string {
  return (
    text
      // \[ … \] → display math on its own lines.
      .replace(/\\\[([\s\S]+?)\\\]/g, (_match, body: string) => `\n\n$$\n${body.trim()}\n$$\n\n`)
      // \( … \) → inline math.
      .replace(/\\\(([\s\S]+?)\\\)/g, (_match, body: string) => `$${body.trim()}$`)
      // A line that is nothing but $$…$$ was meant to be display math.
      .replace(
        /^[ \t]*\$\$[ \t]*(\S[^\n]*?)[ \t]*\$\$[ \t]*$/gm,
        (_match, body: string) => `$$\n${body}\n$$`,
      )
  );
}

export function normalizeMath(source: string): string {
  return source
    .split(CODE_SEGMENT)
    .map((segment, index) => (index % 2 === 1 ? segment : rewrite(segment)))
    .join("");
}
