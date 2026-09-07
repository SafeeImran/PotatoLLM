import { memo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeHighlight from "rehype-highlight";
import type { Options as HighlightOptions } from "rehype-highlight";

// Imported here rather than in main.tsx so the stylesheets travel with this
// module's lazy chunk instead of the startup bundle.
import "katex/dist/katex.min.css";
import "../../styles/markdown.css";

import { normalizeMath } from "./normalizeMath";

import bash from "highlight.js/lib/languages/bash";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import csharp from "highlight.js/lib/languages/csharp";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import go from "highlight.js/lib/languages/go";
import ini from "highlight.js/lib/languages/ini";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import shell from "highlight.js/lib/languages/shell";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";

/**
 * An explicit language set rather than highlight.js's `common` bundle: this
 * ships inside a desktop binary, and the full set is several hundred KB of
 * grammars for languages a local model is very unlikely to emit.
 */
const LANGUAGES: HighlightOptions["languages"] = {
  bash,
  c,
  cpp,
  csharp,
  css,
  diff,
  go,
  ini,
  toml: ini,
  java,
  javascript,
  js: javascript,
  jsx: javascript,
  json,
  markdown,
  md: markdown,
  python,
  py: python,
  rust,
  rs: rust,
  shell,
  sh: shell,
  console: shell,
  sql,
  typescript,
  ts: typescript,
  tsx: typescript,
  xml,
  html: xml,
  yaml,
  yml: yaml,
};

const REMARK = [remarkGfm, remarkMath];
const REHYPE = [
  // throwOnError keeps a half-typed formula from blowing up mid-stream; the
  // raw source stays visible in the error colour until the closing $ arrives.
  [rehypeKatex, { throwOnError: false, errorColor: "var(--pot-danger)" }],
  [rehypeHighlight, { languages: LANGUAGES, detect: true, subset: ["python", "javascript", "typescript", "rust", "json", "bash"] }],
] as const;

function CodeBlock({ language, children }: { language: string | null; children: React.ReactNode }) {
  const [copied, setCopied] = useState(false);

  async function copy(e: React.MouseEvent<HTMLButtonElement>) {
    const source = e.currentTarget.closest(".pot-code")?.querySelector("code")?.textContent ?? "";
    try {
      await navigator.clipboard.writeText(source);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      // Clipboard denied (or unavailable in a test env) — leave the label alone.
    }
  }

  return (
    <div className="pot-code">
      <div className="pot-code-bar">
        <span className="pot-code-lang">{language ?? "text"}</span>
        <button type="button" className="pot-code-copy" onClick={copy}>
          {copied ? "copied" : "copy"}
        </button>
      </div>
      <pre>{children}</pre>
    </div>
  );
}

/**
 * Renders assistant output as Markdown: GFM (tables, task lists, strikethrough),
 * fenced code with syntax highlighting, and LaTeX via KaTeX. Delimiters are
 * normalised first (see normalizeMath) so `\(…\)` and `\[…\]` work too.
 *
 * Raw HTML is deliberately NOT enabled. Model output is untrusted text, and
 * react-markdown escaping it by default is the thing keeping a generated
 * `<img onerror=…>` inert.
 */
export const Markdown = memo(function Markdown({ children }: { children: string }) {
  return (
    <div className="pot-md">
      <ReactMarkdown
        remarkPlugins={REMARK}
        rehypePlugins={REHYPE as never}
        components={{
          // Fenced blocks are wrapped from `pre`, not `code`: react-markdown 10
          // dropped the `inline` flag, and the parent element is the only
          // reliable way to tell a fence from inline code.
          pre({ children, node }) {
            const codeNode = node?.children.find(
              (child) => child.type === "element" && child.tagName === "code",
            );
            const classes =
              codeNode && codeNode.type === "element"
                ? ((codeNode.properties?.className as string[] | undefined) ?? [])
                : [];
            const language = classes
              .map(String)
              .find((name) => name.startsWith("language-"))
              ?.slice("language-".length);
            return <CodeBlock language={language ?? null}>{children}</CodeBlock>;
          },
          code({ className, children, ...props }) {
            // Inside a fence rehype-highlight always sets a class; inline code
            // never has one.
            if (className) {
              return (
                <code className={className} {...props}>
                  {children}
                </code>
              );
            }
            return (
              <code className="pot-code-inline" {...props}>
                {children}
              </code>
            );
          },
          table: ({ children }) => (
            <div className="pot-md-table">
              <table>{children}</table>
            </div>
          ),
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noreferrer noopener">
              {children}
            </a>
          ),
        }}
      >
        {normalizeMath(children)}
      </ReactMarkdown>
    </div>
  );
});

export default Markdown;
