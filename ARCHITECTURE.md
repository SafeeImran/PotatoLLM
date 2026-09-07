# Architecture

## Process model

```
PotatoLLM Desktop (Tauri 2 window)
        |
        v
React + TypeScript UI  ──fetch (HTTP, loopback only)──>  Potato Core (Python/FastAPI, child process)
        ^                                                        |
        |                                                        v
   Tauri Rust shell                                         SQLite (via SQLAlchemy + Alembic)
   (spawns/supervises
    the core process)
```

- **Tauri's Rust layer is deliberately thin.** Its only real job is spawning Potato Core as a
  child process on launch (`apps/desktop/src-tauri/src/lib.rs`), streaming its stdout/stderr to
  the dev console, polling until its port accepts connections, and killing it on app exit. It
  exposes no `#[tauri::command]`s for app logic — the UI never reaches into Rust for business
  logic, and never shells out to `llama.cpp`/Python directly either.
- **The UI talks to Potato Core only over HTTP** (`http://127.0.0.1:47823`), via the typed client
  in `apps/desktop/src/api/`. This is the "Local IPC" the product spec calls for — implemented
  pragmatically as a loopback HTTP API rather than raw stdin/stdout IPC, because it's testable
  with `curl`/pytest independent of the desktop shell, and the FastAPI/Pydantic layer doubles as
  the IPC contract definition.
- **Only Potato Core touches the database.** SQLite lives under the OS-appropriate app-data
  directory (`%APPDATA%/PotatoLLM` on Windows) and is only ever opened by the Python process.

Why not Tauri's `tauri-plugin-shell` sidecar API for this? That's aimed at bundling a
self-contained binary and spawning it through the shell plugin's own `CommandChild` type — but the
Job Object kill-on-close wiring (`job_object.rs`) needs a raw `std::process::Child` handle, and
`tauri-plugin-shell` doesn't expose one. Instead, production packaging (Phase 16) uses
`tauri.conf.json`'s `bundle.resources` to ship the PyInstaller-built `core/dist/potato-core/`
directory (built via `core/packaging/potato-core.spec`) wholesale, and `spawn_core()` in `lib.rs`
resolves `potato-core.exe` inside it via `app.path().resource_dir()` — still a plain
`std::process::Command`, so Job Object wrapping is identical between dev and release. Dev mode
spawns the venv's `python.exe -m potato_core.main` directly instead; `spawn_core()` branches on
`cfg!(debug_assertions)` to pick between the two. See DEVELOPMENT.md's "Building a release
installer" for the build steps.

## Potato Core layout

```
core/potato_core/
  main.py            FastAPI app: CORS, router registration, runs Alembic migrations on startup
  config.py           Settings singleton: data dir, DB path, port, mock-hardware flag
  logging_config.py   Structured logging to console + rotating file
  api/                 HTTP routers — thin, delegate to engines/
  engines/              One subpackage per independently-testable system (spec section 3), all real:
    hardware/            base.py (Protocol), real.py (psutil/py-cpuinfo/pynvml), mock.py,
                          score.py (Potato Score), service.py (orchestration + persistence)
    storage/              Real on-disk accounting, DB-vs-disk reconciliation, guarded deletion
    settings/             Typed setting registry + validation; every key has a named real consumer
    jobs/                 DB-backed Job lifecycle CRUD (create/progress/complete/fail/cancel)
    models/                Curated registry (32 models, 11 with vision) + seeding, plus
                          packs.py — named sets meant to be loaded together, priced by the SUM
                          of their members and graded against the machine
    downloads/             Resumable streaming HTTP downloads with corruption guards
    quantization/          llama-quantize wrapper: dry-run estimates, real tensor-progress parsing
    inference/              Spawns/talks to llama-server per loaded model; Job Object-wrapped.
                          llama_cpp_backend.py holds N models resident at once ("slots"), each
                          with a role (primary/vision/code/reasoning) and its own process.
                          orchestrator.py runs one chat turn across them: if the turn has images
                          and the answering model cannot see, the vision slot describes them
                          first and the description is handed over, announced not silent.
                          runtime.py resolves the load-time flags (context, threads, GPU
                          offload, batch, flash attention, KV cache) from request → setting →
                          hardware detection, and only emits flags the vendored binary lists
    training/               Real dataset analysis + hyperparameter mapping + job lifecycle; the
                          PEFT/TRL training loop itself is the one deliberately-deferred piece
                          (see "What's explicitly deferred" below)
    benchmark/              Real fixed-prompt runs with live hardware sampling
    recommendation/          "Make It Potato": bpw-scaled compatibility math + orchestration
    build/                 Named, runnable artifact + runtime-config bundles
    usage/                  Per-generation UsageRecord persistence + rollups
    doctor/                 Real environment diagnostics (Phase 15)
    logs/                   Real rotating-log-file reader (Phase 15) + real log clearing
  db/
    base.py               SQLAlchemy engine/session
    models.py              Every entity from spec section 34, even ones with no engine yet
    migrations/             Alembic; migration 0001 creates the full schema
  schemas/                Pydantic request/response models — the actual IPC contract
```

### Why the full DB schema now, but only two engines?

Migrating schema is cheap when done up front and expensive to retrofit once builds/benchmarks/
adapters reference each other. `db/models.py` defines all thirteen entities now (with two
intentional non-cycles — see below) so later phases add an engine and wire it to an existing
table, not invent a table under time pressure.

**FK cycle note**: `adapters` and `training_jobs` reference each other conceptually (a job
produces an adapter; an adapter came from a job), and so do `builds` and `benchmarks` (a build has
a latest benchmark; a benchmark belongs to a build). A real foreign-key cycle between two tables
makes SQLAlchemy/Alembic's table-creation ordering unsolvable — Alembic autogenerate detected this
and silently dropped the constraints from the DDL. We keep one direction of each relationship
(`training_jobs.output_adapter_id`, `benchmarks.build_id`) and drop the redundant reverse column;
the reverse lookup is one indexed query away (`training_jobs WHERE output_adapter_id = ...`,
`benchmarks WHERE build_id = ... ORDER BY created_at DESC LIMIT 1`), not a missing feature.

## Hardware detection: real vs. mock

`engines/hardware/base.py` defines a `HardwareProvider` Protocol (`detect()`, `poll_live()`).
`RealHardwareProvider` uses `psutil`/`py-cpuinfo` for CPU/RAM and `pynvml` for NVIDIA GPU/VRAM,
falling back to `"Unknown"`/`None` field-by-field on any detection failure — never a fabricated
number (spec section 9). `MockHardwareProvider` returns fixed, obviously-labeled values (every
field is prefixed `[MOCK]` or otherwise clearly synthetic) for development on machines without a
target GPU. `engines/hardware/service.py` is the only module the API layer calls; it picks the
provider based on `POTATOLLM_MOCK_HARDWARE`, and every `HardwareSnapshot` it returns carries an
`is_mock` flag the UI renders as a visible "Mock Data" badge — mock data can never be silently
mistaken for a measurement (spec sections 43-44).

## Potato Score

`engines/hardware/score.py` is a pure function: `HardwareSnapshot -> PotatoScoreResult`. Five
weighted dimensions (VRAM 40pts, RAM 20pts, CPU 15pts, storage 10pts, backend 15pts) sum to a
0-100 score with a five-tier classification. Weights are named constants at the top of the file
so they can be retuned later without touching any caller — every call site goes through
`compute_potato_score()`, never reimplements the formula.

## A note on CSP

`tauri.conf.json`'s `app.security.csp` is currently `null` (no CSP enforced) — not the final
state, but a deliberate one. An initial attempt at a locked-down CSP
(`default-src 'self'; ...`) built and ran `cargo check` cleanly but caused the actual app window
to open and immediately close every time (silent failure, clean exit code, no panic — easy to
mistake for a build problem). The cause: Vite dev mode's React Fast Refresh preamble is injected
as an inline `<script>`, which a `script-src` that isn't explicitly opened up for it blocks;
WebView2 failing to load the page this way was enough to make Tauri treat the window as closed and
quit. A real, non-obvious failure mode worth remembering before re-tightening the CSP: any future
attempt needs to either special-case dev mode (looser `script-src` only when `devUrl` is active) or
find the right nonce/hash for Vite's injected scripts, and must be verified by actually watching
the window stay open, not just by a clean `cargo check`/build.

## Frontend

- **Routing**: `react-router-dom` with `HashRouter` (Tauri's webview origin doesn't support
  arbitrary history-API paths the way a real web server would).
- **Server state**: `@tanstack/react-query` for all Potato Core API calls — handles loading/error
  states and polling (the live hardware monitor refetches every 3s) without hand-rolled effects.
- **Design system**: `apps/desktop/src/styles/tokens.css` defines every color/radius/shadow/
  timing as a Tailwind v4 `@theme` token (spec section 49) — components consume `bg-surface`,
  `text-fg-secondary`, etc., never a raw hex value. Two accent colors are intentional: `accent`
  (cyan) for general interactive/technical UI, `potato` (amber) reserved for potato-branded
  moments only (Potato Score, "Make It Potato", classification badges) so it doesn't get diluted
  into a generic primary color.
- Every nav section is real; `PlaceholderPage` (an honest "not built yet, lands in Phase N" message
  rather than any fake data — spec section 51) is now unused by any route but kept as a component
  in case future nav additions need it again.

## Settings: a registry, not a bag of keys

`engines/settings/registry.py` declares every application setting as a typed
`SettingDefinition` — type, bounds, default, section, and an `effect` string naming
the real code that reads it. `engines/settings/service.py` is the only way values are
read or written, and it enforces two rules:

- **Unknown keys are rejected.** A setting that nothing consumes cannot be stored, so
  the Settings page can never render a control that does nothing (spec section 51's
  no-fake-features rule, applied to preferences). Every definition's `effect` names its
  consumer, and a test asserts none is blank.
- **Reads always resolve.** `get()` returns the stored value if it still validates and
  the registry default otherwise, so consumers call it unconditionally — and a value
  stored under looser bounds in an earlier release degrades to the default instead of
  raising into every caller.

The Settings page renders entirely from `GET /settings/schema`; adding a setting is a
registry entry plus a consumer, with no frontend change. Consumers call `get()` at the
point of use rather than caching, so a change lands on the next model load / download /
generation without restarting the core. Settings that configure live process state (the
log level) are additionally applied through `_apply_side_effects`, and re-applied from
`main.py`'s lifespan after migrations — the values live in the database, so they can't
be read at `configure_logging()` time.

`hidden=True` marks internal state that happens to live in the settings table
(`onboarding_complete`): validated and persisted like anything else, never offered as a
control, and skipped by "reset all" — which would otherwise drop the user back into the
first-run hardware scan.

## Storage: the database and the disk are reconciled, not assumed to agree

`engines/storage/service.py` treats `model_artifacts` rows and the files under
`models/` as two sources that can disagree, and reports both directions: a row whose
file has vanished is `missing`, a file no row claims is `untracked`. This is not
hypothetical — the `%APPDATA%/PotatoLLM` directory has been observed getting cleared out
from under an install, and without reconciliation the app keeps offering models whose
files are gone. `auto_purge_missing_artifacts` (off by default, since dropping rows is
destructive) runs the cleanup at startup for users who want it.

Deletion is guarded rather than guessed: a path is only touched if it resolves inside
the managed data directory (`_assert_inside_data_dir`, resolved first so `..` and
symlinks can't escape), an artifact loaded for inference can't be deleted at all, and an
artifact a Build depends on needs an explicit force — which then deletes those Builds,
because a Build without its file isn't runnable. Real measurements survive: benchmarks
and past inference sessions are detached (their `model_artifact_id` nulled), never
deleted along with the file.

## What's explicitly deferred

All 16 spec phases are now built, including production packaging (Phase 16 — see above and
DEVELOPMENT.md). Deliberately still not real: the fine-tuning training loop itself
(`engines/training/service.py::start_training()` fails with an honest "install `pip install -e
".[train]"`" error rather than faking training — dataset analysis, hyperparameter mapping, and job
lifecycle are all real, only the actual PEFT/TRL loop is unbuilt), and GPU-accelerated llama.cpp
backends (only the CPU build is vendored/packaged; CUDA/Vulkan/ROCm builds exist upstream at the
same release but aren't wired up).
