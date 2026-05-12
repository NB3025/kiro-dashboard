"""Tests for facet_extractor — per-session Bedrock call that produces a Korean
CC-style Facet JSON.

Pure functions first (deterministic). Bedrock I/O is passed as an injected
callable so we can unit-test without AWS.
"""

import io
import json
from unittest.mock import MagicMock

from facet_extractor import (
    format_session_transcript,
    build_facet_prompt,
    parse_facet_json,
    is_valid_facet,
    extract_facet_for_session,
    MIN_TURNS_FOR_FACET,
)


def test_format_session_transcript_includes_session_header():
    turns = [
        {"timestamp": "2026-05-03T09:00:00Z", "prompt": "hello", "assistant_response": "hi"},
    ]
    text = format_session_transcript(
        session_id="abc1234567",
        turns=turns,
        tier="SPEC",
        spec_name="my-project",
    )
    assert "Session: abc12345" in text
    assert "Type: SPEC" in text
    assert "my-project" in text


def test_format_session_transcript_truncates_long_messages():
    long_user = "a" * 1000
    long_ai = "b" * 1000
    turns = [
        {"timestamp": "2026-05-03T09:00:00Z", "prompt": long_user, "assistant_response": long_ai},
    ]
    text = format_session_transcript(session_id="s", turns=turns, tier="DAY", spec_name=None)
    assert len([line for line in text.splitlines() if line.startswith("[User]")]) == 1
    # User truncated to 500, Assistant to 300 (CC pipeline §2 / §7 limits)
    assert "a" * 500 in text
    assert "a" * 501 not in text
    assert "b" * 300 in text
    assert "b" * 301 not in text


def test_build_facet_prompt_includes_korean_directive():
    txt = build_facet_prompt("SESSION TEXT HERE")
    assert "한국어" in txt or "Korean" in txt
    assert "RESPOND WITH ONLY A VALID JSON OBJECT" in txt
    assert "SESSION TEXT HERE" in txt


def test_build_facet_prompt_uses_kiro_helpfulness_not_claude():
    # 브랜드 일관성: user_instructions_to_kiro처럼 helpfulness도 kiro_로 통일.
    txt = build_facet_prompt("")
    assert "kiro_helpfulness" in txt
    assert "claude_helpfulness" not in txt


def test_primary_success_enum_excludes_tool_based_values():
    # Kiro raw logs carry tool-invocation evidence in only ~0.2% of turns
    # (see docs/facet-review-samples analysis). Without that evidence the LLM
    # hallucinates file/search outcomes. Restrict primary_success to text-only
    # signals it can actually derive from the transcript.
    txt = build_facet_prompt("")
    assert "fast_accurate_search" not in txt
    assert "correct_code_edits" not in txt
    assert "multi_file_changes" not in txt
    # Kept values (text-observable from transcript) must still be there:
    for kept in ("none", "good_explanations", "proactive_help", "good_debugging"):
        assert kept in txt


def test_build_facet_prompt_lists_all_cc_facet_fields():
    txt = build_facet_prompt("")
    for k in [
        "underlying_goal",
        "goal_categories",
        "outcome",
        "user_satisfaction_counts",
        "friction_counts",
        "brief_summary",
        "user_instructions_to_kiro",
    ]:
        assert k in txt


def test_parse_facet_json_extracts_first_json_object():
    text = 'Here is the result:\n{"underlying_goal":"x","outcome":"fully_achieved"}\ntrailing'
    result = parse_facet_json(text)
    assert result == {"underlying_goal": "x", "outcome": "fully_achieved"}


def test_parse_facet_json_returns_none_on_invalid():
    assert parse_facet_json("no json") is None
    assert parse_facet_json("") is None


def test_is_valid_facet_checks_required_keys():
    good = {
        "underlying_goal": "a",
        "outcome": "b",
        "brief_summary": "c",
        "goal_categories": {},
        "user_satisfaction_counts": {},
        "friction_counts": {},
        "user_instructions_to_kiro": [],
    }
    assert is_valid_facet(good) is True
    bad = dict(good)
    del bad["brief_summary"]
    assert is_valid_facet(bad) is False


def test_extract_facet_for_session_skips_short_sessions():
    turns = [{"timestamp": "t", "prompt": "p", "assistant_response": "r"}]  # only 1 turn
    assert MIN_TURNS_FOR_FACET >= 2  # documented minimum
    result = extract_facet_for_session(
        session={"session_id": "s", "tier": "DAY", "spec_name": None},
        turns=turns,
        bedrock_invoker=lambda prompt: '{"x":1}',
    )
    assert result is None


def test_extract_facet_for_session_calls_bedrock_and_parses():
    turns = [
        {"timestamp": "2026-05-03T09:00:00Z", "prompt": "안녕", "assistant_response": "반갑습니다"},
        {"timestamp": "2026-05-03T09:05:00Z", "prompt": "고마워", "assistant_response": "천만에요"},
        {"timestamp": "2026-05-03T09:10:00Z", "prompt": "끝", "assistant_response": "완료"},
    ]
    good_json = json.dumps({
        "underlying_goal": "인사",
        "outcome": "fully_achieved",
        "brief_summary": "간단한 인사 세션",
        "goal_categories": {"chat": 3},
        "user_satisfaction_counts": {"satisfied": 1},
        "friction_counts": {},
        "user_instructions_to_kiro": [],
    })
    called = {}
    def invoker(prompt: str) -> str:
        called["prompt"] = prompt
        return good_json

    result = extract_facet_for_session(
        session={"session_id": "s1", "tier": "SPEC", "spec_name": "my-project"},
        turns=turns,
        bedrock_invoker=invoker,
    )
    assert result is not None
    assert result["brief_summary"] == "간단한 인사 세션"
    assert "한국어" in called["prompt"] or "Korean" in called["prompt"]
    assert "my-project" in called["prompt"]


def test_extract_facet_returns_none_when_bedrock_returns_invalid_json():
    turns = [
        {"timestamp": "t", "prompt": "p", "assistant_response": "r"},
        {"timestamp": "t", "prompt": "p", "assistant_response": "r"},
    ]
    result = extract_facet_for_session(
        session={"session_id": "s", "tier": "DAY", "spec_name": None},
        turns=turns,
        bedrock_invoker=lambda p: "not valid",
    )
    assert result is None


def test_extract_facet_returns_none_when_required_field_missing():
    turns = [
        {"timestamp": "t", "prompt": "p", "assistant_response": "r"},
        {"timestamp": "t", "prompt": "p", "assistant_response": "r"},
    ]
    incomplete = json.dumps({"underlying_goal": "x"})  # missing everything else
    result = extract_facet_for_session(
        session={"session_id": "s", "tier": "DAY", "spec_name": None},
        turns=turns,
        bedrock_invoker=lambda p: incomplete,
    )
    assert result is None
