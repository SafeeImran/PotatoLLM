"""Model packs — curated sets of models meant to be run together.

Its own router rather than a route under /models, because `/models/{model_id}`
is a catch-all that would swallow `/models/packs` as a model called "packs".
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException

from potato_core.engines import downloads as download_service
from potato_core.engines.models import packs as pack_engine
from potato_core.schemas.packs import PackDownloadResponse, PacksResponse

router = APIRouter(prefix="/packs", tags=["packs"])


@router.get("", response_model=PacksResponse)
def list_packs(context_length: int | None = None) -> dict:
    """Every pack, priced against this machine, with the best fit flagged."""
    return pack_engine.evaluate(context_length=context_length)


@router.post("/{pack_id}/download", response_model=PackDownloadResponse)
def download_pack(pack_id: str) -> dict:
    """Queue every member of a pack that is not already on disk."""
    try:
        members = pack_engine.members_of(pack_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    evaluation = pack_engine.evaluate()
    pack = next((p for p in evaluation["packs"] if p["id"] == pack_id), None)
    already = {m["model_id"] for m in (pack or {}).get("members", []) if m["downloaded"]}

    queued: list[str] = []
    job_ids: list[str] = []
    for member in members:
        if member.model_id in already:
            continue
        try:
            job = download_service.start_download(member.model_id)
        except ValueError as exc:
            # One unavailable member should not sink the rest of the pack.
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        queued.append(member.model_id)
        job_ids.append(job["job_id"])

    return {
        "pack_id": pack_id,
        "queued_model_ids": queued,
        "already_downloaded_model_ids": sorted(already),
        "job_ids": job_ids,
    }
