"""Fine-tuning Engine (spec sections 23, 25-27) — real job lifecycle and
slider-to-hyperparameter mapping; the PEFT/TRL training loop itself is
gated behind a real, honest dependency check (dependencies.py) rather than
faked, per spec section 51. See service.py.
"""
from potato_core.engines.training.dependencies import check_ml_dependencies
from potato_core.engines.training.hyperparameters import (
    Hyperparameters,
    SliderInputs,
    map_sliders_to_hyperparameters,
)
from potato_core.engines.training.service import (
    TrainingError,
    create_training_job,
    get_training_job,
    list_training_jobs,
    pause_training,
    start_training,
    stop_training,
)

__all__ = [
    "Hyperparameters",
    "SliderInputs",
    "TrainingError",
    "check_ml_dependencies",
    "create_training_job",
    "get_training_job",
    "list_training_jobs",
    "map_sliders_to_hyperparameters",
    "pause_training",
    "start_training",
    "stop_training",
]
