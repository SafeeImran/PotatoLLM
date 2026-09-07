"""Tests for the pure dataset parsing/analysis logic (spec section 24)."""
from __future__ import annotations

import json

import pytest

from potato_core.engines.datasets.analysis import analyze_file, count_tokens, detect_format


def _write(tmp_path, name, content):
    p = tmp_path / name
    p.write_text(content, encoding="utf-8")
    return p


def test_count_tokens_is_real_and_deterministic():
    a = count_tokens("Hello, world!")
    b = count_tokens("Hello, world!")
    assert a == b
    assert a > 0
    assert count_tokens("") == 0
    assert count_tokens("a longer sentence with several more words in it") > a


def test_detect_format_from_extension(tmp_path):
    assert detect_format(tmp_path / "x.jsonl") == "jsonl"
    assert detect_format(tmp_path / "x.json") == "json"
    assert detect_format(tmp_path / "x.csv") == "csv"
    assert detect_format(tmp_path / "x.txt") == "txt"


def test_detect_format_rejects_unsupported_extension(tmp_path):
    with pytest.raises(ValueError, match="Unsupported"):
        detect_format(tmp_path / "x.parquet")


def test_jsonl_text_field_examples_are_valid(tmp_path):
    content = "\n".join(json.dumps({"text": f"Example number {i}."}) for i in range(5))
    p = _write(tmp_path, "d.jsonl", content)
    result = analyze_file(p)
    assert result.example_count == 5
    assert result.valid_count == 5
    assert result.invalid_count == 0
    assert result.valid_pct == 100.0


def test_jsonl_chat_messages_format_is_valid(tmp_path):
    record = {"messages": [{"role": "user", "content": "hi"}, {"role": "assistant", "content": "hello"}]}
    p = _write(tmp_path, "d.jsonl", json.dumps(record))
    result = analyze_file(p)
    assert result.valid_count == 1


def test_jsonl_prompt_completion_format_is_valid(tmp_path):
    record = {"prompt": "What is the capital of France?", "completion": "Paris."}
    p = _write(tmp_path, "d.jsonl", json.dumps(record))
    result = analyze_file(p)
    assert result.valid_count == 1


def test_jsonl_instruction_output_format_is_valid(tmp_path):
    record = {"instruction": "Summarize this.", "input": "Some long text.", "output": "A summary."}
    p = _write(tmp_path, "d.jsonl", json.dumps(record))
    result = analyze_file(p)
    assert result.valid_count == 1


def test_jsonl_flags_invalid_json_without_crashing(tmp_path):
    content = "\n".join([json.dumps({"text": "ok"}), "{not valid json", json.dumps({"text": "ok2"})])
    p = _write(tmp_path, "d.jsonl", content)
    result = analyze_file(p)
    assert result.example_count == 3
    assert result.valid_count == 2
    assert result.invalid_count == 1
    assert "invalid JSON" in result.invalid_reasons


def test_jsonl_flags_missing_recognized_fields(tmp_path):
    p = _write(tmp_path, "d.jsonl", json.dumps({"foo": "bar", "baz": 123}))
    result = analyze_file(p)
    assert result.valid_count == 0
    assert result.invalid_count == 1
    assert any("missing recognized fields" in reason for reason in result.invalid_reasons)


def test_jsonl_skips_blank_lines_without_counting_them(tmp_path):
    content = json.dumps({"text": "a"}) + "\n\n\n" + json.dumps({"text": "b"})
    p = _write(tmp_path, "d.jsonl", content)
    result = analyze_file(p)
    assert result.example_count == 2


def test_json_array_of_examples(tmp_path):
    data = [{"text": "one"}, {"text": "two"}, {"text": "three"}]
    p = _write(tmp_path, "d.json", json.dumps(data))
    result = analyze_file(p)
    assert result.example_count == 3
    assert result.valid_count == 3


def test_json_non_array_root_raises(tmp_path):
    p = _write(tmp_path, "d.json", json.dumps({"text": "not an array"}))
    with pytest.raises(ValueError, match="must be an array"):
        analyze_file(p)


def test_json_invalid_syntax_raises(tmp_path):
    p = _write(tmp_path, "d.json", "{not valid json at all")
    with pytest.raises(ValueError, match="Invalid JSON"):
        analyze_file(p)


def test_csv_with_text_column(tmp_path):
    content = "text\nHello there\nHow are you\n"
    p = _write(tmp_path, "d.csv", content)
    result = analyze_file(p)
    assert result.example_count == 2
    assert result.valid_count == 2


def test_csv_with_prompt_completion_columns(tmp_path):
    content = "prompt,completion\nWhat is 1+1?,It is 2.\n"
    p = _write(tmp_path, "d.csv", content)
    result = analyze_file(p)
    assert result.valid_count == 1


def test_csv_empty_file_has_zero_examples(tmp_path):
    p = _write(tmp_path, "d.csv", "")
    result = analyze_file(p)
    assert result.example_count == 0
    assert result.valid_pct == 0.0


def test_txt_each_nonblank_line_is_one_example(tmp_path):
    content = "Line one.\n\nLine two.\n   \nLine three."
    p = _write(tmp_path, "d.txt", content)
    result = analyze_file(p)
    assert result.example_count == 3
    assert result.valid_count == 3
    assert result.valid_pct == 100.0


def test_duplicate_detection_counts_exact_repeats(tmp_path):
    content = "\n".join(
        [
            json.dumps({"text": "This exact example repeats."}),
            json.dumps({"text": "This exact example repeats."}),
            json.dumps({"text": "This exact example repeats."}),
            json.dumps({"text": "This one is unique."}),
        ]
    )
    p = _write(tmp_path, "d.jsonl", content)
    result = analyze_file(p)
    assert result.valid_count == 4
    assert result.duplicate_count == 2  # 2nd and 3rd occurrence
    assert result.duplicate_pct == 50.0


def test_avg_and_max_tokens_reflect_real_content_length(tmp_path):
    content = "\n".join(
        [
            json.dumps({"text": "short"}),
            json.dumps({"text": "a somewhat longer example sentence with more words in it than the first"}),
        ]
    )
    p = _write(tmp_path, "d.jsonl", content)
    result = analyze_file(p)
    assert result.max_tokens is not None
    assert result.avg_tokens is not None
    assert result.max_tokens >= result.avg_tokens
    assert result.estimated_tokens == sum([count_tokens("short"), count_tokens("a somewhat longer example sentence with more words in it than the first")])


def test_all_invalid_dataset_reports_zero_valid_pct(tmp_path):
    content = "\n".join([json.dumps({"foo": "bar"}), "not json"])
    p = _write(tmp_path, "d.jsonl", content)
    result = analyze_file(p)
    assert result.valid_count == 0
    assert result.valid_pct == 0.0
    assert result.duplicate_pct == 0.0  # no valid examples to compare
    assert result.avg_tokens is None
    assert result.max_tokens is None
