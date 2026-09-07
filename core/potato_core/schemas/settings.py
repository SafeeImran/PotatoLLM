from __future__ import annotations

from typing import Any

from pydantic import BaseModel


class SettingValue(BaseModel):
    key: str
    value: Any


class ResolvedSetting(BaseModel):
    value: Any
    is_default: bool


class SettingDefinitionResponse(BaseModel):
    key: str
    section: str
    label: str
    description: str
    type: str
    default: Any
    minimum: float | None
    maximum: float | None
    options: list[str]
    unit: str | None
    effect: str


class ResetRequest(BaseModel):
    key: str | None = None
