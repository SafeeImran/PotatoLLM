# PyInstaller spec for Potato Core (Phase 16 packaging).
#
# Builds a onedir bundle at dist/potato-core/ containing potato-core.exe plus
# everything it needs (alembic.ini, db/migrations/, vendor/llama-cpu/, an
# offline tiktoken cache if the build machine has one) laid out flat — see
# --contents-directory "." below, which disables PyInstaller 6.x's default
# nested _internal/ folder so potato_core.config._core_dir() can find
# bundled data at the same relative paths it uses in dev.
#
# Build with: pyinstaller packaging/potato-core.spec --distpath dist --noconfirm
# (run from core/, with the packaging extra installed: pip install -e ".[package]")
import os
import tempfile

from PyInstaller.utils.hooks import collect_all

CORE_DIR = os.path.abspath(os.path.join(SPECPATH, ".."))

datas = [
    (os.path.join(CORE_DIR, "alembic.ini"), "."),
    (os.path.join(CORE_DIR, "potato_core", "db", "migrations"), os.path.join("potato_core", "db", "migrations")),
]

vendor_dir = os.path.join(CORE_DIR, "vendor", "llama-cpu")
if os.path.isdir(vendor_dir):
    datas.append((vendor_dir, os.path.join("vendor", "llama-cpu")))
else:
    print(f"WARNING: {vendor_dir} not found — packaged app won't be able to run inference. "
          f"Fetch it per DEVELOPMENT.md before building.")

# Bundle the build machine's own tiktoken BPE cache if it has one, so the
# packaged app doesn't need network access on first dataset analysis. Purely
# best-effort: if absent, tiktoken just falls back to fetching over the
# network at runtime (see config.py's TIKTOKEN_CACHE_DIR handling).
_tiktoken_cache = os.path.join(tempfile.gettempdir(), "data-gym-cache")
if os.path.isdir(_tiktoken_cache):
    for _entry in os.listdir(_tiktoken_cache):
        datas.append((os.path.join(_tiktoken_cache, _entry), "tiktoken-cache"))

binaries = []

hidden_submodules = []
excluded_binaries = []
for _pkg in ("uvicorn", "alembic"):
    _pkg_datas, _pkg_binaries, _pkg_hidden = collect_all(_pkg)
    datas += _pkg_datas
    binaries += _pkg_binaries
    hidden_submodules += _pkg_hidden

a = Analysis(
    [os.path.join(CORE_DIR, "potato_core", "main.py")],
    pathex=[CORE_DIR],
    binaries=binaries,
    datas=datas,
    hiddenimports=hidden_submodules,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    # Fine-tuning's heavy ML deps are an opt-in `pip install -e ".[train]"`
    # even in dev (see pyproject.toml) — never bundle them even if a dev's
    # own venv happens to have them installed for local testing.
    excludes=["torch", "transformers", "peft", "trl", "bitsandbytes"],
    noarchive=False,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="potato-core",
    console=True,
    contents_directory=".",
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    name="potato-core",
)
