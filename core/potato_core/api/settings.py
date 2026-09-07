from __future__ import annotations

from fastapi import APIRouter, HTTPException

from potato_core.engines import settings as settings_engine
from potato_core.schemas.settings import (
    ResetRequest,
    ResolvedSetting,
    SettingDefinitionResponse,
    SettingValue,
)

router = APIRouter(prefix="/settings", tags=["settings"])


@router.get("", response_model=dict[str, ResolvedSetting])
def list_settings() -> dict:
    """Every known setting with its effective value — a stored override where
    one exists, the registry default otherwise. Callers never have to handle a
    missing key."""
    return settings_engine.get_all()


@router.get("/schema", response_model=list[SettingDefinitionResponse])
def settings_schema() -> list[dict]:
    """The typed definitions the Settings page renders its controls from."""
    return settings_engine.definitions()


@router.put("", response_model=SettingValue)
def put_setting(body: SettingValue) -> dict:
    try:
        value = settings_engine.set_value(body.key, body.value)
    except settings_engine.SettingsError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"key": body.key, "value": value}


@router.post("/reset", response_model=dict[str, ResolvedSetting])
def reset_settings(body: ResetRequest | None = None) -> dict:
    try:
        return settings_engine.reset(body.key if body else None)
    except settings_engine.SettingsError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
