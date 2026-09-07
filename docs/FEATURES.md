# Features, screen by screen

Every screen in PotatoLLM is backed by real work. Where a capability is not implemented, the
screen says so rather than showing invented data.

## First launch

On first run the app scans your hardware and shows the result before you reach the main window.
The scan is real: CPU model and cores through py-cpuinfo, GPU and VRAM through NVML, RAM and disk
through psutil. Anything that cannot be read shows as "Unknown", never a placeholder number.

## Playground

The app's home screen and its main job.

* Streaming chat against a locally loaded model, with a live tokens per second readout and a
  time to first token measurement.
* Several models can be resident at once, each with a role (primary, vision, code, reasoning).
* Image handoff. If you attach an image and the answering model cannot see, a loaded vision
  model describes the image first and that description is passed to the answering model. The
  handoff is shown in the transcript, not hidden.
* An idle backdrop that draws a Lorenz attractor in ASCII, purely decorative.
* Attachments: images, PDF and DOCX. PDF and DOCX text is extracted locally.
* A Live Monitor drawer on the right with the sampling knobs (temperature, top p, top k, max
  tokens and more) and the llama.cpp runtime knobs (context, threads, GPU offload, batch, flash
  attention, KV cache), each with an Auto option that resolves against your detected hardware.

## Model Library

* A Catalog tab with 32 curated open source models. Search, filter by family or capability, sort
  by size, context or best fit. Hover a row for a spec card. The whole row washes green, yellow
  or red on hover to show whether it runs on your machine.
* A Packs tab. A Pack is a set of models meant to load together, priced by the sum of its
  members because that is how they run. Packs are graded against your machine and sorted so the
  ones that fit lead. The app also assembles a Pack tailored to your exact memory budget.
* A "Quantize" action per model. See the Quantize flow below.

## Downloads

Real streaming HTTP downloads from verified Hugging Face GGUF URLs. Resumable through HTTP range
requests. Pause, cancel, retry. A size check runs before the file is accepted, so a truncated
download never becomes a usable model.

## Quantize (the one click flow)

Reads your latest hardware profile and the target model, computes compatibility using bits per
weight ratios taken from the llama.cpp quantize binary's own help output, picks the best
quantization this app can produce, and then drives whatever real step is next: download the
weights, download a full precision source, run local conversion. It polls one idempotent
endpoint until a runnable file exists, so it is safe to click again.

## Optimize

The manual version of the above. Pick a model that has a full precision source, pick a target
quantization (a preset or an advanced level), see a real size estimate, then run the real
conversion with a live tensor by tensor progress read from llama-quantize output.

## Benchmarks

Runs a fixed prompt through the real inference engine while a background thread samples real
hardware (CPU and GPU utilisation, VRAM, RAM, temperature) every 200ms. The result is a measured
tokens per second, a measured time to first token, and the hardware samples, all persisted.

## Usage

Records a usage entry after every streamed generation. Shows tokens today, average speed,
average time to first token, session and generation counts, a 14 day trend, a per model
breakdown, a prompt versus completion split, and a session performance scatter. Every figure is
measured, none is estimated.

## Build History

A Build is a named bundle of a verified model file plus a runtime config (name, context length,
backend). Create, rename, duplicate, delete. Deleting a Build never touches the underlying model
file. A Build tracks its own last benchmark.

## Fine tune

* A real dataset manager. Parses JSONL, JSON, CSV and TXT in several record shapes, counts
  tokens with tiktoken, flags duplicates and invalid rows.
* A real slider to hyperparameter mapping. Five sliders resolve to learning rate, epochs, LoRA
  rank and alpha, dropout, batch size, gradient accumulation, warmup, sequence length and
  scheduler.
* A real job lifecycle: create, start, pause, stop.
* The actual training loop is not implemented. Starting a job checks for torch, transformers,
  peft and trl and fails with an actionable message if they are missing. This is deliberate.

## Storage

Reconciles the `model_artifacts` table against the files on disk and reports both directions: a
row whose file vanished, and a file no row claims. Deletion is guarded. A path is only touched
if it resolves inside the managed data directory, a model loaded for inference cannot be
deleted, and a model a Build depends on needs an explicit force which then removes those Builds.
Past benchmarks and sessions survive their model file.

## Settings

Renders entirely from a typed setting registry. Every setting names the real code that consumes
it, and a test asserts none of those names is blank. Unknown keys and out of range values are
rejected. Adding a setting is a registry entry plus a consumer, with no UI change.

## Potato Doctor

Seven real environment probes: Python, GPU, CUDA, llama.cpp, model directory writable, storage
headroom, fine tuning dependencies. Lives in the Settings page's Advanced section.

## Logs

Reads the rotating core log file, most recent first, aware of multi line tracebacks. Search,
filter by level, copy, export. Opens from the Playground header.

## Command palette

Ctrl+K anywhere. Fuzzy filters 16 navigation and action commands. Ctrl+1 through Ctrl+5 jump
straight to the five primary sections.

## Appearance

In the sidebar's account menu: light or dark mode, small, default or large text size, GT
Walsheim or Space Grotesk, and a Baked Potato or Monochromatic colour treatment for the sidebar
in light mode.
