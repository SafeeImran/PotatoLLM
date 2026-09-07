import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Markdown } from "../components/chat/Markdown";

describe("Markdown", () => {
  it("renders a fenced code block with its language and a copy button", () => {
    const { container } = render(
      <Markdown>{"Here:\n\n```python\ndef f(x):\n    return x * 2\n```\n"}</Markdown>,
    );

    const block = container.querySelector(".pot-code");
    expect(block).not.toBeNull();
    expect(block?.querySelector(".pot-code-lang")?.textContent).toBe("python");
    expect(screen.getByRole("button", { name: "copy" })).toBeInTheDocument();
    expect(block?.querySelector("code")?.textContent).toContain("return x * 2");
  });

  it("highlights code rather than dumping it as plain text", () => {
    const { container } = render(<Markdown>{"```python\ndef f():\n    pass\n```"}</Markdown>);
    expect(container.querySelector(".pot-code code .hljs-keyword")).not.toBeNull();
  });

  it("keeps inline code inline", () => {
    const { container } = render(<Markdown>{"Call `load()` first."}</Markdown>);
    expect(container.querySelector(".pot-code-inline")?.textContent).toBe("load()");
    expect(container.querySelector(".pot-code")).toBeNull();
  });

  it("typesets inline and display LaTeX with KaTeX", () => {
    const { container } = render(
      <Markdown>{"Mass-energy is $E = mc^2$.\n\n$$\\int_0^1 x^2\\,dx = \\frac{1}{3}$$"}</Markdown>,
    );

    expect(container.querySelectorAll(".katex").length).toBeGreaterThanOrEqual(2);
    // A one-line $$…$$ still becomes display math: remark-math alone reads it
    // as inline, so normalizeMath splits the delimiters onto their own lines.
    expect(container.querySelector(".katex-display")).not.toBeNull();
    // The TeX source survives for copy/paste and screen readers.
    expect(container.querySelector("annotation")?.textContent).toContain("E = mc^2");
  });

  it("accepts LaTeX's own delimiters, which models emit constantly", () => {
    const { container } = render(
      <Markdown>{"Inline \\(a^2 + b^2 = c^2\\) and block:\n\n\\[e^{i\\pi} + 1 = 0\\]"}</Markdown>,
    );

    expect(container.querySelectorAll(".katex").length).toBeGreaterThanOrEqual(2);
    expect(container.querySelector(".katex-display")).not.toBeNull();
    expect(container.textContent).not.toContain("\\(");
  });

  it("leaves LaTeX-looking delimiters inside code alone", () => {
    const { container } = render(
      <Markdown>{"```python\nprint(a\\[0\\])\n```\n\nand `x \\(y\\)` inline"}</Markdown>,
    );

    expect(container.querySelector(".pot-code code")?.textContent).toContain("a\\[0\\]");
    expect(container.querySelector(".pot-code-inline")?.textContent).toContain("\\(y\\)");
    expect(container.querySelector(".katex")).toBeNull();
  });

  it("does not blow up on a formula that is still streaming in", () => {
    const { container } = render(<Markdown>{"The integral $\\int_0^1 x^"}</Markdown>);
    expect(container.textContent).toContain("The integral");
  });

  it("does not blow up on a code fence that is still streaming in", () => {
    const { container } = render(<Markdown>{"```python\ndef f():\n    ret"}</Markdown>);
    expect(container.querySelector(".pot-code code")?.textContent).toContain("def f():");
  });

  it("renders GFM tables inside their own scroll container", () => {
    render(<Markdown>{"| task | score |\n| --- | --- |\n| gsm8k | 74.2 |\n"}</Markdown>);

    const table = screen.getByRole("table");
    expect(table.parentElement).toHaveClass("pot-md-table");
    expect(screen.getByRole("columnheader", { name: "score" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "74.2" })).toBeInTheDocument();
  });

  it("escapes raw HTML instead of rendering it", () => {
    const { container } = render(<Markdown>{'<img src=x onerror="alert(1)">'}</Markdown>);
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("<img");
  });
});
