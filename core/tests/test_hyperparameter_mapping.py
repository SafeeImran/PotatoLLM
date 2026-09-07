"""Tests for the slider-to-hyperparameter mapping (spec section 25)."""
from __future__ import annotations

from potato_core.engines.training.hyperparameters import (
    Hyperparameters,
    SliderInputs,
    map_sliders_to_hyperparameters,
)


def test_default_middle_sliders_produce_sane_values():
    hp = map_sliders_to_hyperparameters(SliderInputs())
    assert 5e-5 <= hp.learning_rate <= 5e-4
    assert 1 <= hp.epochs <= 5
    assert hp.lora_rank in (4, 8, 16, 32, 64)
    assert hp.lora_alpha == hp.lora_rank * 2
    assert 0.0 <= hp.lora_dropout <= 0.1
    assert hp.batch_size in (1, 2, 4, 8, 16)
    assert hp.gradient_accumulation_steps >= 1
    assert 0.0 <= hp.warmup_ratio <= 0.1
    assert hp.max_seq_length in (512, 1024, 1536, 2048)
    assert hp.scheduler in ("linear", "cosine")


def test_lightest_settings_produce_the_smallest_config():
    hp = map_sliders_to_hyperparameters(
        SliderInputs(training_intensity=0.0, learning_rate=0.0, training_time=0.0, model_adaptation=0.0, memory_usage=0.0)
    )
    assert hp.epochs == 1
    assert hp.lora_rank == 4
    assert hp.learning_rate == 5e-5
    assert hp.max_seq_length == 512
    assert hp.scheduler == "linear"


def test_heaviest_settings_produce_the_largest_config():
    hp = map_sliders_to_hyperparameters(
        SliderInputs(training_intensity=1.0, learning_rate=1.0, training_time=1.0, model_adaptation=1.0, memory_usage=1.0)
    )
    assert hp.epochs == 5
    assert hp.lora_rank == 64
    assert hp.learning_rate == 5e-4
    assert hp.max_seq_length == 2048
    assert hp.scheduler == "cosine"


def test_epochs_increases_monotonically_with_training_intensity():
    epochs = [
        map_sliders_to_hyperparameters(SliderInputs(training_intensity=t)).epochs for t in (0.0, 0.25, 0.5, 0.75, 1.0)
    ]
    assert epochs == sorted(epochs)


def test_learning_rate_increases_monotonically_with_its_slider():
    rates = [map_sliders_to_hyperparameters(SliderInputs(learning_rate=t)).learning_rate for t in (0.0, 0.25, 0.5, 0.75, 1.0)]
    assert rates == sorted(rates)


def test_lora_rank_increases_monotonically_with_model_adaptation():
    ranks = [
        map_sliders_to_hyperparameters(SliderInputs(model_adaptation=t)).lora_rank for t in (0.0, 0.25, 0.5, 0.75, 1.0)
    ]
    assert ranks == sorted(ranks)


def test_lora_alpha_always_tracks_twice_the_rank():
    for t in (0.0, 0.2, 0.4, 0.6, 0.8, 1.0):
        hp = map_sliders_to_hyperparameters(SliderInputs(model_adaptation=t))
        assert hp.lora_alpha == hp.lora_rank * 2


def test_batch_size_increases_monotonically_with_memory_usage():
    sizes = [map_sliders_to_hyperparameters(SliderInputs(memory_usage=t)).batch_size for t in (0.0, 0.25, 0.5, 0.75, 1.0)]
    assert sizes == sorted(sizes)


def test_gradient_accumulation_compensates_for_small_batch_size():
    low_mem = map_sliders_to_hyperparameters(SliderInputs(memory_usage=0.0))
    high_mem = map_sliders_to_hyperparameters(SliderInputs(memory_usage=1.0))
    assert low_mem.batch_size < high_mem.batch_size
    assert low_mem.gradient_accumulation_steps > high_mem.gradient_accumulation_steps
    # Effective batch size should land in a similar ballpark either way.
    low_effective = low_mem.batch_size * low_mem.gradient_accumulation_steps
    high_effective = high_mem.batch_size * high_mem.gradient_accumulation_steps
    assert abs(low_effective - high_effective) <= max(low_effective, high_effective) * 0.5


def test_out_of_range_slider_values_are_clamped_not_rejected():
    hp_low = map_sliders_to_hyperparameters(SliderInputs(training_intensity=-5.0))
    hp_high = map_sliders_to_hyperparameters(SliderInputs(training_intensity=99.0))
    assert hp_low.epochs == 1
    assert hp_high.epochs == 5


def test_mapping_is_deterministic():
    sliders = SliderInputs(training_intensity=0.37, learning_rate=0.62, training_time=0.5, model_adaptation=0.8, memory_usage=0.1)
    a = map_sliders_to_hyperparameters(sliders)
    b = map_sliders_to_hyperparameters(sliders)
    assert a == b


def test_to_dict_round_trips_all_fields():
    hp = map_sliders_to_hyperparameters(SliderInputs())
    d = hp.to_dict()
    assert set(d.keys()) == set(Hyperparameters.__dataclass_fields__.keys())
