from __future__ import annotations

from pydantic import BaseModel


class ModelResponse(BaseModel):
    id: str
    name: str
    family: str
    parameter_count: str
    architecture: str
    context_length: int
    license: str
    source: str
    model_url: str
    supported_backends: list[str]
    supported_quant_formats: list[str]
    finetune_support: bool
    est_ram_mb: int
    est_vram_mb: int
    recommended_quantizations: list[str]
    description: str
    tags: list[str]
    capabilities: list[str]
    fp16_available: bool = False

    model_config = {"from_attributes": True}
