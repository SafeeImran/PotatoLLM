# Changelog

All notable changes to this project are recorded here. The format follows Keep a Changelog, and
the project uses semantic versioning.

## v0.1.0

First tagged release. Every one of the 16 planned build phases is implemented.

### Core

* Real hardware detection (CPU, GPU, VRAM through NVML, RAM, disk) with an honest "Unknown"
  fallback field by field, never a fabricated value. Real CPU utilisation added along the way.
* Potato Score: a pure function from a hardware snapshot to a 0 to 100 score and a five tier
  classification, with named weight constants.
* Curated model registry: 32 open source models with real Hugging Face metadata, 11 of them
  able to read images. Model Packs, priced by the sum of their members and graded against the
  machine, plus a Pack assembled per device.
* Resumable streaming downloads from verified Hugging Face GGUF URLs, with a size check that
  rejects a truncated file.
* Inference engine wrapping the official vendored llama.cpp `llama-server` binary. Holds several
  models resident at once, each with a role. Runs a chat turn across them and hands an image
  description from a vision model to a text model when needed. Windows Job Objects keep child
  processes from surviving a hard kill of the app.
* Quantization engine over `llama-quantize` with real dry run size estimation and real tensor
  progress parsing.
* Benchmark engine: a fixed prompt run through real inference while a background thread samples
  real hardware every 200ms.
* Usage analytics: a usage entry persisted after every streamed generation, rolled into daily
  and all time figures and a per model breakdown.
* Build manager: named model plus config bundles with create, rename, duplicate, delete.
* Recommendation engine and the one click flow, now labelled "Quantize" in the UI.
* Fine tuning: real dataset analysis, real slider to hyperparameter mapping, real job lifecycle.
  The PEFT and TRL training loop is deliberately not implemented and fails with an honest
  message.
* Settings as a typed registry where every key names its real consumer. Storage with database
  to disk reconciliation and guarded deletion. Potato Doctor with seven real probes. A real
  rotating log file reader.
* Packaging: the core is bundled as a standalone PyInstaller sidecar and shipped inside the
  Tauri resources. Verified end to end with a silent install and uninstall.

### UI

* Tauri 2 shell, React plus TypeScript plus Vite plus Tailwind CSS v4, talking to the core only
  over `http://127.0.0.1:47823`.
* Playground with streaming chat, a live tokens per second readout, multiple model slots, image
  handoff shown in the transcript, attachments (image, PDF, DOCX), and a Live Monitor drawer.
* Dashboard, Model Library (Catalog and Packs tabs, spec card on hover, whole row compatibility
  wash), Downloads, Optimize, Benchmarks, Usage, Build History, Fine tune, Storage, Settings,
  Logs, Profile, Hardware.
* Command palette (Ctrl+K) over every screen and action.
* A design system where every colour, radius and timing is a token. One accent, used sparingly.
* Appearance controls: light or dark, three text sizes that reach the whole app including the
  shell chrome, two typefaces, two sidebar colour treatments.
* A single tag treatment across the app: a machined index label with no fill, a hairline border
  and a clipped corner, in place of tinted pills.
* Progress bars borrow the slider vocabulary: a bracketed dashed track with a travelling glow.

### Tests

* 354 backend tests, 145 frontend tests.

### Known limitations

* The fine tuning training loop is not implemented. See README.
* Only the CPU llama.cpp backend is vendored and packaged.
* Development and packaging target Windows.
* The bundled GT Walsheim Condensed font files are trial versions. See docs/FONTS.md.
