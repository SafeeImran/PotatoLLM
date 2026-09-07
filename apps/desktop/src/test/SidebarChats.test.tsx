import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { Sidebar } from "../components/layout/Sidebar";
import { PlaygroundProvider, type Conversation } from "../playground/PlaygroundProvider";

const STORAGE_KEY = "potatollm.playground.conversations";

const SEED: Conversation[] = [
  { id: "a", title: "Eval sweep", messages: [], updatedAt: 3_000 },
  { id: "b", title: "Tokenizer diff", messages: [], updatedAt: 2_000 },
  { id: "c", title: "Router latency", messages: [], updatedAt: 1_000 },
];

function renderSidebar() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <PlaygroundProvider>
          <Sidebar />
        </PlaygroundProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function chatMenu(title: string) {
  return screen.getByRole("button", { name: `Actions for ${title}` });
}

describe("Sidebar chats", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(SEED));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({}), { status: 200 })),
    );
  });

  it("orders the sidebar workspace, chats, then tools", () => {
    renderSidebar();
    for (const chat of SEED) expect(screen.getByText(chat.title)).toBeInTheDocument();

    const headings = screen.getAllByText(/^(chats|workspace|tools)$/i).map((el) => el.textContent);
    expect(headings).toEqual(["Workspace", "Chats", "Tools"]);
  });

  it("puts New chat at the very top, outside every group", () => {
    renderSidebar();
    const newChat = screen.getByRole("button", { name: "New chat" });
    const workspace = screen.getByRole("button", { name: /workspace/i });

    // Above the Workspace heading, and not a descendant of any group.
    expect(newChat.compareDocumentPosition(workspace)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(newChat.closest("[aria-expanded]")).toBeNull();
  });

  it("does not mint a second chat while an empty one is already open", async () => {
    // Every click used to add a row, so holding the button gave an unbounded
    // run of identical "New chat" entries with no way to tell them apart.
    renderSidebar();
    const button = screen.getByRole("button", { name: "New chat" });

    await userEvent.click(button);
    await userEvent.click(button);
    await userEvent.click(button);

    // One row in the list, plus the button itself.
    expect(screen.getAllByText("New chat")).toHaveLength(2);
  });

  it("collapses a stored run of empty chats down to one", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([
        ...SEED,
        { id: "x", title: "New chat", messages: [], updatedAt: 9_000 },
        { id: "y", title: "New chat", messages: [], updatedAt: 8_000 },
        { id: "z", title: "New chat", messages: [], updatedAt: 7_000 },
      ]),
    );
    renderSidebar();

    expect(screen.getAllByText("New chat")).toHaveLength(2);
    for (const chat of SEED) expect(screen.getByText(chat.title)).toBeInTheDocument();
  });

  it("collapses the workspace and tools groups", async () => {
    renderSidebar();
    const workspace = screen.getByRole("button", { name: /workspace/i });
    expect(workspace).toHaveAttribute("aria-expanded", "true");

    await userEvent.click(workspace);
    expect(workspace).toHaveAttribute("aria-expanded", "false");
  });

  it("filters chats through the search button", async () => {
    renderSidebar();
    await userEvent.click(screen.getByRole("button", { name: "Search chats" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Search chats" }), "token");

    expect(screen.getByText("Tokenizer diff")).toBeInTheDocument();
    expect(screen.queryByText("Eval sweep")).not.toBeInTheDocument();
  });

  it("offers pin, remove, archive and delete on each chat", async () => {
    renderSidebar();
    await userEvent.click(chatMenu("Eval sweep"));

    const menu = screen.getByRole("menu", { name: "Actions for Eval sweep" });
    expect(within(menu).getByRole("menuitem", { name: "Pin" })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: "Remove messages" })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: "Archive" })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: "Delete" })).toBeInTheDocument();
  });

  it("archives a chat out of the list and back via the Archived filter", async () => {
    renderSidebar();
    await userEvent.click(chatMenu("Router latency"));
    await userEvent.click(screen.getByRole("menuitem", { name: "Archive" }));

    expect(screen.queryByText("Router latency")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Filter chats" }));
    await userEvent.click(screen.getByRole("menuitemradio", { name: "Archived" }));

    expect(screen.getByText("Router latency")).toBeInTheDocument();
    expect(screen.queryByText("Eval sweep")).not.toBeInTheDocument();
  });

  it("deletes a chat permanently", async () => {
    renderSidebar();
    await userEvent.click(chatMenu("Tokenizer diff"));
    await userEvent.click(screen.getByRole("menuitem", { name: "Delete" }));

    expect(screen.queryByText("Tokenizer diff")).not.toBeInTheDocument();
    expect(screen.getByText("Eval sweep")).toBeInTheDocument();
  });

  it("floats pinned chats to the top of the list", async () => {
    renderSidebar();
    await userEvent.click(chatMenu("Router latency"));
    await userEvent.click(screen.getByRole("menuitem", { name: "Pin" }));

    const titles = SEED.map((c) => c.title);
    const rendered = screen
      .getAllByText(new RegExp(`^(${titles.join("|")})$`))
      .map((el) => el.textContent);
    expect(rendered[0]).toBe("Router latency");
  });
});
