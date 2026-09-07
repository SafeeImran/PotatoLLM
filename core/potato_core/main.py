"""Potato Core entrypoint — a local-only FastAPI server the Tauri shell spawns
as a child process and talks to over loopback HTTP. Never exposed beyond
127.0.0.1.
"""
from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from potato_core.api import attachments as attachments_api, benchmark as benchmark_api, build as build_api, dataset as dataset_api, doctor as doctor_api, downloads as downloads_api, hardware, health, inference as inference_api, logs as logs_api, models as models_api, packs as packs_api, quantization as quantization_api, recommendation as recommendation_api, settings as settings_api, storage, training as training_api, usage as usage_api
from potato_core.config import _CORE_DIR, settings
from potato_core.engines import inference as inference_engine
from potato_core.engines import settings as app_settings
from potato_core.engines import storage as storage_engine
from potato_core.engines.models import seed_models
from potato_core.logging_config import configure_logging, get_logger

log = get_logger("main")


def _run_migrations() -> None:
    from alembic import command
    from alembic.config import Config

    cfg = Config(str(_CORE_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(_CORE_DIR / "potato_core" / "db" / "migrations"))
    command.upgrade(cfg, "head")


@asynccontextmanager
async def lifespan(app: FastAPI):
    configure_logging()
    log.info("Potato Core starting — data dir: %s", settings.data_dir)
    _run_migrations()
    log.info("Database migrated to head")
    seed_models()
    log.info("Model registry seeded")

    # Settings live in the database, so anything that configures live process
    # state (currently the log level) can only be applied once migrations have
    # run — configure_logging() above starts from the env-var default.
    app_settings.apply_startup_settings()

    if app_settings.get("auto_purge_missing_artifacts"):
        # The data directory can be cleared out from under an install; when the
        # user has opted in, drop the now-dangling artifact rows so the app
        # doesn't offer models whose files are gone.
        result = storage_engine.purge_missing_artifacts()
        if result["purged_artifact_ids"]:
            log.info(
                "Auto-purged %d model artifact row(s) with no file on disk",
                len(result["purged_artifact_ids"]),
            )

    yield
    inference_engine.unload_model()  # never leave an orphaned llama-server child behind
    log.info("Potato Core shutting down")


app = FastAPI(title="Potato Core", version="0.1.0", lifespan=lifespan)

# Local-only server bound to 127.0.0.1; CORS is just satisfying the webview's
# fetch policy, not a network security boundary.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(attachments_api.router)
app.include_router(benchmark_api.router)
app.include_router(build_api.router)
app.include_router(dataset_api.router)
app.include_router(doctor_api.router)
app.include_router(downloads_api.router)
app.include_router(hardware.router)
app.include_router(inference_api.router)
app.include_router(logs_api.router)
app.include_router(models_api.router)
app.include_router(packs_api.router)
app.include_router(quantization_api.router)
app.include_router(recommendation_api.router)
app.include_router(settings_api.router)
app.include_router(storage.router)
app.include_router(training_api.router)
app.include_router(usage_api.router)


def run() -> None:
    import uvicorn

    uvicorn.run(app, host=settings.host, port=settings.port, log_config=None)


if __name__ == "__main__":
    run()
