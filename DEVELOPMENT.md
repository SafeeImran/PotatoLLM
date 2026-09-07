# Development

## Prerequisites

- Node.js 20+ and npm
- Python 3.11+
- Rust (stable-msvc on Windows) + platform build tools — required by Tauri 2:
  - Windows: `winget install --id Rustlang.Rustup -e` then Visual Studio Build Tools with the
    "Desktop development with C++" workload
    (`winget install --id Microsoft.VisualStudio.2022.BuildTools -e`)
  - See https://tauri.app/start/prerequisites/ for macOS/Linux

## First-time setup

```bash
# Python core
cd core
python -m venv .venv
./.venv/Scripts/pip install -e ".[dev]"   # .venv/bin/pip on macOS/Linux

# Frontend
cd ../apps/desktop
npm install
```

### Inference engine (llama.cpp)

The Inference Engine shells out to the official `llama-server` binary rather than bundling a
compiled dependency in the repo. Fetch it once:

```bash
cd core
mkdir -p vendor && cd vendor
curl -L -o llama-cpu.zip https://github.com/ggml-org/llama.cpp/releases/download/b10566/llama-b10566-bin-win-cpu-x64.zip
powershell -Command "Expand-Archive -Path llama-cpu.zip -DestinationPath llama-cpu -Force"
rm llama-cpu.zip
```

This is the CPU-only build (~19MB, works on any machine). `core/potato_core/config.py`'s
`llama_server_executable` expects it at `core/vendor/llama-cpu/llama-server.exe` — CUDA/Vulkan/ROCm
builds exist at the same release (see the [b10566 release assets](https://github.com/ggml-org/llama.cpp/releases/tag/b10566))
for GPU acceleration, not wired up yet. `core/vendor/` is gitignored — every dev fetches their own copy.

## Running in dev

```bash
cd apps/desktop
npm run tauri dev
```

This launches the Tauri window, which spawns `core/.venv/Scripts/python.exe -m potato_core.main`
as a child process bound to `127.0.0.1:47823` (see `src-tauri/src/lib.rs`). Core stdout/stderr are
prefixed `[potato-core]` in the terminal running `tauri dev`. The database and other local data
live under `%APPDATA%/PotatoLLM` (Windows) — Alembic migrations run automatically on core startup.

To iterate on the frontend alone without the Rust shell (faster reload, but you must start the
core manually first): run `python -m potato_core.main` in `core/`, then `npm run dev` in
`apps/desktop/` and open the printed `localhost:1420` URL in a browser. `HashRouter` and the fixed
core port make this work outside the Tauri webview too.

### Forcing mock hardware

Real detection needs an NVIDIA GPU (via `pynvml`) to report a GPU at all — everything else falls
back to CPU-only, which is honest but not useful for testing GPU-dependent UI. Set
`POTATOLLM_MOCK_HARDWARE=true` before starting the core to use `MockHardwareProvider` instead;
every value it returns is visibly tagged (`[MOCK]` fields, `is_mock: true`) so it can't be
confused with a real reading.

```bash
POTATOLLM_MOCK_HARDWARE=true ./.venv/Scripts/python.exe -m potato_core.main
```

## Tests

```bash
# Python core
cd core
./.venv/Scripts/python -m pytest

# Frontend
cd apps/desktop
npm run test
```

## Building a release installer

Release builds bundle Potato Core as a standalone PyInstaller-built sidecar (`potato-core.exe`)
instead of spawning the dev venv's `python.exe` — end users don't need Python installed at all.
`src-tauri/src/lib.rs`'s `spawn_core()` branches on `cfg!(debug_assertions)` to pick between the
two; everything else (readiness polling, Job Object lifecycle, shutdown) is identical either way.

```bash
# 1. Build the Potato Core sidecar (from core/, with the packaging extra installed)
cd core
./.venv/Scripts/pip install -e ".[package]"
./.venv/Scripts/python -m PyInstaller packaging/potato-core.spec --distpath dist --workpath build --noconfirm

# 2. Build the installer (from apps/desktop/) — picks up core/dist/potato-core/
#    via tauri.conf.json's bundle.resources automatically
cd ../apps/desktop
npm run tauri build
```

Installers land in `src-tauri/target/release/bundle/msi/` and `.../nsis/`. Requires
`core/vendor/llama-cpu/` to already be fetched (see above) — the spec bundles it into the sidecar;
skipping this step still builds, but the packaged app won't be able to run inference.

The PyInstaller spec (`core/packaging/potato-core.spec`) uses `--contents-directory .` so bundled
data (alembic.ini, db/migrations/, vendor/llama-cpu/, and an offline tiktoken BPE cache if the
build machine has one cached) sits flat alongside `potato-core.exe` rather than under PyInstaller
6.x's default nested `_internal/` — this lets `potato_core/config.py`'s frozen-mode path resolution
(`sys.executable`'s parent dir) match the same relative layout it uses in dev
(`Path(__file__).resolve().parent.parent`). If you add new data files the packaged core needs at
runtime, they need an entry in that spec's `datas` list, or they simply won't exist in the build.

## Database migrations

Schema changes go in `core/potato_core/db/models.py`, then generate a migration:

```bash
cd core
./.venv/Scripts/python -m alembic revision --autogenerate -m "describe the change"
./.venv/Scripts/python -m alembic upgrade head
```

Check the generated migration for silently-dropped constraints — Alembic will warn in its output
if it can't resolve a foreign-key ordering (see the FK-cycle note in ARCHITECTURE.md); don't ship
a migration with that warning still present.
