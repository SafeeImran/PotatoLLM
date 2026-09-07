# PotatoLLM

A desktop app for running open source language models on the hardware you already own. It scans
your machine, scores what it can handle, helps you pick and shrink a model that fits, runs the
model locally, and shows you exactly how fast it goes. Everything happens on your computer.
Nothing is sent anywhere.

The name is the idea. Your machine is a potato. Make the model fit the potato.

## What it does

**See your machine clearly.** Real detection of CPU, GPU, VRAM (through NVML), RAM and disk, with
an honest "Unknown" wherever a value genuinely cannot be read rather than a guess. A single
Potato Score from 0 to 100 rolls that up into one number and a tier, from Tiny Potato to Potato
Beast.

**Find a model that fits.** A curated catalog of 32 open source models (Llama, Qwen, Mistral,
Phi, Gemma, DeepSeek, SmolVLM and more, 11 of them able to read images) with real Hugging Face
metadata. Every model shows an estimate of what it costs to run on your specific machine, and a
green, yellow or red verdict. Curated Packs bundle models meant to run together, one to answer,
one to read images, one for code, and the app assembles a Pack tailored to your exact memory
budget.

**Download safely.** Resumable streaming downloads straight from verified Hugging Face GGUF URLs,
with pause, cancel, retry and a size check that refuses a truncated file.

**Shrink a model to fit.** One click "Quantize" inspects your hardware and the model, picks the
best quantization this app can actually produce, and drives the real pipeline (download, then
local conversion with llama.cpp) until you have a runnable file. There is also a manual Optimize
screen with a live size estimate before you commit.

**Run it and chat.** A Playground with real streaming chat and a measured tokens per second
readout. The app can hold several models resident at once, each with a role. If your chat model
cannot see an image you attach, a vision model describes it first and the description is handed
over, announced rather than hidden.

**Measure, do not assume.** A Benchmark engine runs a fixed prompt through the real inference
engine while a background thread samples real hardware every 200ms. A Usage page records every
generation and rolls it into tokens per day, average speed, time to first token, and a per model
breakdown. Every measured number comes from an actual run.

**Keep it tidy.** A Build History of named, runnable model plus config bundles. A Storage page
that reconciles the database against what is actually on disk and deletes safely. A Settings
page where every control names the real code that reads it. A Potato Doctor that runs seven real
environment checks. A command palette (Ctrl+K) over every screen and action.

**Fine tuning** has a real dataset manager (JSONL, JSON, CSV and TXT parsing with real token
counts and duplicate detection), a real slider to hyperparameter mapping, and a real job
lifecycle. The actual PEFT and TRL training loop is deliberately left unbuilt and the app says so
plainly instead of faking progress. See "What is deferred" below.

## Stack

| Layer | Choice |
| --- | --- |
| Desktop shell | Tauri 2 (Rust), deliberately thin |
| UI | React, TypeScript, Vite, Tailwind CSS v4 |
| Core | Python 3.11+ and FastAPI, spawned as a child process, reachable only over loopback |
| Data | SQLite through SQLAlchemy and Alembic |
| Inference | Official llama.cpp `llama-server` binary, vendored on setup |
| Optional ML | PyTorch, Transformers, PEFT, TRL for the fine tuning loop |

The Rust layer only spawns and supervises the Python core and kills it on exit. All application
logic lives in the Python core and the React UI. The UI talks to the core over
`http://127.0.0.1:47823`, never by shelling out. Only the core touches the database.

Full rationale is in [ARCHITECTURE.md](ARCHITECTURE.md).

## Running it

You need Node 20+, Python 3.11+, and Rust with the platform build tools for Tauri 2. Full steps,
including how to fetch the llama.cpp binary, are in [DEVELOPMENT.md](DEVELOPMENT.md). Short
version:

```bash
# Python core
cd core
python -m venv .venv
./.venv/Scripts/pip install -e ".[dev]"     # .venv/bin/pip on macOS and Linux

# llama.cpp binary (see DEVELOPMENT.md for the exact URL)
# fetches into core/vendor/llama-cpu/

# Frontend
cd ../apps/desktop
npm install

# Run the whole thing
npm run tauri dev
```

## Tests

```bash
cd core && ./.venv/Scripts/python -m pytest      # 354 tests
cd apps/desktop && npm run test                  # 145 tests
```

## Project layout

```
apps/desktop/          Tauri shell + React UI
  src/                 UI: pages, components, api client, hooks, styles
  src-tauri/           Rust: spawns and supervises the Python core
core/
  potato_core/
    api/               HTTP routers, thin, delegate to engines
    engines/           one package per independently testable system
    db/                SQLAlchemy models and Alembic migrations
    schemas/           Pydantic request and response models
  tests/               pytest suite
docs/                  extra documentation
prototypes/            early design explorations, kept for reference
```

## What is deferred

Every one of the 16 planned build phases is implemented, including production installers. Two
things are intentionally not real yet, and the app is honest about both:

1. **The fine tuning training loop.** Dataset analysis, hyperparameter mapping and job lifecycle
   are all real. `engines/training/service.py` checks for torch, transformers, peft and trl at
   call time and fails a job with a clear "install the training extra" message rather than
   faking a run.
2. **GPU accelerated llama.cpp backends.** Only the CPU build is vendored and packaged. CUDA,
   Vulkan and ROCm builds exist upstream at the same release but are not wired up.

## A note on platform

Development and packaging so far target Windows. The vendored llama.cpp binary is the Windows
x64 CPU build, and the release installers are an MSI and an NSIS setup. The core and the UI are
cross platform in principle (the Python core runs fine on macOS and Linux, `HashRouter` and the
fixed core port make the UI work in a plain browser), but the vendored binary path and the
packaging config would need per platform work.

## Fonts

The UI loads GT Walsheim Condensed. The files under `apps/desktop/public/fonts/` are trial
versions. Read [docs/FONTS.md](docs/FONTS.md) before distributing a build. Space Grotesk, the
alternate typeface, is under the SIL Open Font License.

## License

MIT. See [LICENSE](LICENSE).
