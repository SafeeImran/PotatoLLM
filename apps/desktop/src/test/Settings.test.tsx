import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Settings from "../pages/Settings";
import type { SettingDefinition, SettingsMap } from "../api/types";

const SCHEMA: SettingDefinition[] = [
  {
    key: "developer_mode",
    section: "General",
    label: "Developer Mode",
    description: "Exposes diagnostics and raw technical logs across the app.",
    type: "bool",
    default: false,
    minimum: null,
    maximum: null,
    options: [],
    unit: null,
    effect: "Shows the raw-log view on the Logs page.",
  },
  {
    key: "default_context_length",
    section: "Inference",
    label: "Default Context Length",
    description: "Context window used when loading a model.",
    type: "int",
    default: 4096,
    minimum: 512,
    maximum: 131072,
    options: [],
    unit: "tokens",
    effect: "Passed to llama-server as -c.",
  },
  {
    key: "low_disk_warning_gb",
    section: "Storage",
    label: "Low Disk Warning",
    description: "Free space below this raises a warning.",
    type: "float",
    default: 10.0,
    minimum: 1.0,
    maximum: 500.0,
    options: [],
    unit: "GB",
    effect: "Threshold for Potato Doctor's Storage check.",
  },
  {
    key: "log_level",
    section: "Privacy",
    label: "Log Level",
    description: "How much detail Potato Core writes to its log file.",
    type: "enum",
    default: "INFO",
    minimum: null,
    maximum: null,
    options: ["DEBUG", "INFO", "WARNING", "ERROR"],
    unit: null,
    effect: "Applied to the Potato Core logger immediately.",
  },
];

const ALL_DEFAULT: SettingsMap = {
  developer_mode: { value: false, is_default: true },
  default_context_length: { value: 4096, is_default: true },
  low_disk_warning_gb: { value: 10.0, is_default: true },
  log_level: { value: "INFO", is_default: true },
};

const DOCTOR = { checks: [], all_pass: true, has_failures: false };

function renderSettings() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <Settings />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function stubFetch({ values = ALL_DEFAULT, putStatus = 200 }: { values?: SettingsMap; putStatus?: number } = {}) {
  const calls: { method: string; url: string; body: unknown }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      const method = init?.method ?? "GET";
      calls.push({ method, url, body: init?.body ? JSON.parse(init.body as string) : undefined });

      if (url.includes("/settings/schema")) return new Response(JSON.stringify(SCHEMA), { status: 200 });
      if (url.includes("/settings/reset")) return new Response(JSON.stringify(ALL_DEFAULT), { status: 200 });
      if (url.includes("/settings") && method === "PUT") {
        if (putStatus !== 200) return new Response("'default_context_length' must be at least 512", { status: putStatus });
        return new Response(JSON.stringify({ key: "ok", value: null }), { status: 200 });
      }
      if (url.includes("/settings")) return new Response(JSON.stringify(values), { status: 200 });
      if (url.includes("/doctor")) return new Response(JSON.stringify(DOCTOR), { status: 200 });
      return new Response(JSON.stringify({}), { status: 200 });
    }),
  );
  return calls;
}

describe("Settings page", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("renders a section per registry section, with real controls", async () => {
    stubFetch();
    renderSettings();

    await waitFor(() => expect(screen.getByText("General")).toBeInTheDocument());
    expect(screen.getByText("Inference")).toBeInTheDocument();
    expect(screen.getByText("Storage")).toBeInTheDocument();
    expect(screen.getByText("Privacy")).toBeInTheDocument();
    expect(screen.getByText("Advanced")).toBeInTheDocument();
    // No placeholder sections left.
    expect(screen.queryByText("Not built yet.")).not.toBeInTheDocument();
  });

  it("tells the user what each setting actually changes, on hover", async () => {
    stubFetch();
    renderSettings();

    const contextLabel = await screen.findByText("Default Context Length");
    expect(screen.queryByText("Passed to llama-server as -c.")).not.toBeInTheDocument();

    await userEvent.hover(contextLabel);
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Passed to llama-server as -c.");

    await userEvent.unhover(contextLabel);
    await userEvent.hover(screen.getByText("Low Disk Warning"));
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Threshold for Potato Doctor's Storage check.");
  });

  it("renders the control type each definition declares", async () => {
    stubFetch();
    renderSettings();

    await waitFor(() => expect(screen.getByRole("switch", { name: "Developer Mode" })).toBeInTheDocument());
    expect(screen.getByRole("spinbutton", { name: "Default Context Length" })).toHaveValue(4096);
    expect(screen.getByRole("combobox", { name: "Log Level" })).toHaveValue("INFO");
    expect(screen.getByText("tokens")).toBeInTheDocument();
  });

  it("writes a toggle straight through to the API", async () => {
    const calls = stubFetch();
    renderSettings();

    await waitFor(() => expect(screen.getByRole("switch", { name: "Developer Mode" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("switch", { name: "Developer Mode" }));

    await waitFor(() => {
      const put = calls.find((c) => c.method === "PUT");
      expect(put?.body).toEqual({ key: "developer_mode", value: true });
    });
  });

  it("commits a number on blur, not on every keystroke", async () => {
    const calls = stubFetch();
    renderSettings();

    await waitFor(() => expect(screen.getByRole("spinbutton", { name: "Default Context Length" })).toBeInTheDocument());
    const input = screen.getByRole("spinbutton", { name: "Default Context Length" });

    fireEvent.change(input, { target: { value: "8192" } });
    // Typing "8", "81", "819" would each be an out-of-range write.
    expect(calls.filter((c) => c.method === "PUT")).toHaveLength(0);

    fireEvent.blur(input);
    await waitFor(() => {
      const put = calls.find((c) => c.method === "PUT");
      expect(put?.body).toEqual({ key: "default_context_length", value: 8192 });
    });
  });

  it("changes an enum through its select", async () => {
    const calls = stubFetch();
    renderSettings();

    await waitFor(() => expect(screen.getByRole("combobox", { name: "Log Level" })).toBeInTheDocument());
    fireEvent.change(screen.getByRole("combobox", { name: "Log Level" }), { target: { value: "DEBUG" } });

    await waitFor(() => {
      const put = calls.find((c) => c.method === "PUT");
      expect(put?.body).toEqual({ key: "log_level", value: "DEBUG" });
    });
  });

  it("surfaces a validation error from the server instead of pretending it saved", async () => {
    stubFetch({ putStatus: 400 });
    renderSettings();

    await waitFor(() => expect(screen.getByRole("switch", { name: "Developer Mode" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("switch", { name: "Developer Mode" }));

    await waitFor(() => expect(screen.getByText(/must be at least 512/)).toBeInTheDocument());
  });

  it("only offers reset where a value has actually been overridden", async () => {
    stubFetch();
    renderSettings();

    await waitFor(() => expect(screen.getByText("Developer Mode")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Reset all to defaults" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Reset Developer Mode/ })).not.toBeInTheDocument();
  });

  it("resets a single overridden setting", async () => {
    const calls = stubFetch({
      values: { ...ALL_DEFAULT, default_context_length: { value: 8192, is_default: false } },
    });
    renderSettings();

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Reset Default Context Length to default" })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Reset Default Context Length to default" }));

    await waitFor(() => {
      const reset = calls.find((c) => c.url.includes("/settings/reset"));
      expect(reset?.body).toEqual({ key: "default_context_length" });
    });
    // The response is the fresh all-defaults map, so the affordance goes away.
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Reset Default Context Length to default" })).not.toBeInTheDocument(),
    );
  });

  it("resets everything at once", async () => {
    const calls = stubFetch({
      values: { ...ALL_DEFAULT, default_context_length: { value: 8192, is_default: false } },
    });
    renderSettings();

    await waitFor(() => expect(screen.getByRole("button", { name: "Reset all to defaults" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Reset all to defaults" }));

    await waitFor(() => {
      const reset = calls.find((c) => c.url.includes("/settings/reset"));
      expect(reset?.body).toEqual({ key: null });
    });
  });

  it("offers real local-data deletion in the Privacy section", async () => {
    stubFetch();
    renderSettings();

    await waitFor(() => expect(screen.getByText("Usage history")).toBeInTheDocument());
    expect(screen.getByText("Local logs")).toBeInTheDocument();
    expect(screen.getByText(/never uploaded/)).toBeInTheDocument();
  });
});
