"""Dataset Manager (spec section 24) — real implementation. See service.py
for registration/persistence and analysis.py for the pure parsing logic.
"""
from potato_core.engines.datasets.service import (
    DatasetError,
    analyze_dataset,
    delete_dataset,
    get_dataset,
    list_datasets,
    register_dataset,
)

__all__ = ["DatasetError", "analyze_dataset", "delete_dataset", "get_dataset", "list_datasets", "register_dataset"]
