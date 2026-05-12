"""Tests for is_routing_turn — filter Kiro's internal routing tag turns
from the ETL pipeline. See docs/reference memory for why (LLM hallucinates
"echo" claims when these turns leak into Facet extraction).

Detection rule verified against 165 real raw samples (Stage 0 analysis):
  - 154 pure {chat, do, spec} JSON forms → filter out
  - 11 mixed (routing + real response text) → keep
"""

import pytest
from prompt_etl import is_routing_turn


def _rec(resp: str):
    return {
        "generateAssistantResponseEventResponse": {"assistantResponse": resp},
    }


# ── True positives (must detect) ─────────────────────────────────────────────

def test_bare_json_is_routing():
    assert is_routing_turn(_rec('{"chat": 0.0, "do": 1.0, "spec": 0.0}')) is True


def test_json_with_code_fence_is_routing():
    resp = '```json\n{"chat": 0.0, "do": 1.0, "spec": 0.0}\n```'
    assert is_routing_turn(_rec(resp)) is True


def test_json_with_unlabeled_fence_is_routing():
    resp = '```\n{"chat": 0.0, "do": 1.0, "spec": 0.0}\n```'
    assert is_routing_turn(_rec(resp)) is True


def test_chat_dominant_is_routing():
    assert is_routing_turn(_rec('{"chat": 0.95, "do": 0.05, "spec": 0.0}')) is True


def test_spec_dominant_is_routing():
    assert is_routing_turn(_rec('{"chat": 0.0, "do": 0.05, "spec": 0.95}')) is True


def test_leading_trailing_whitespace_ok():
    resp = '  \n  {"chat": 0.0, "do": 1.0, "spec": 0.0}  \n\n'
    assert is_routing_turn(_rec(resp)) is True


# ── True negatives (must NOT detect — real responses containing the tag) ─────

def test_routing_followed_by_real_text_is_preserved():
    # Real case: 622 chars, Aurora PostgreSQL explanation after the tag
    resp = (
        '{"chat": 0.0, "do": 1.0, "spec": 0.0}\n\n'
        '네, 완전히 가능합니다. Aurora PostgreSQL Power는 지정된 쿼리를 실행하고...'
    )
    assert is_routing_turn(_rec(resp)) is False


def test_real_text_followed_by_routing_is_preserved():
    # Real case: user-facing response first, routing tag last
    resp = (
        '아뇨, 괜찮습니다. 뭐 필요한 거 있으세요?\n\n'
        '{"chat": 0.0, "do": 1.0, "spec": 0.0}'
    )
    assert is_routing_turn(_rec(resp)) is False


def test_fenced_routing_with_trailing_work_is_preserved():
    resp = (
        '```json\n{"chat": 0.0, "do": 1.0, "spec": 0.0}\n```\n\n'
        "I'll create a PowerPoint presentation from your AIDC business plan."
    )
    assert is_routing_turn(_rec(resp)) is False


def test_empty_response_is_not_routing():
    assert is_routing_turn(_rec("")) is False


def test_normal_response_is_not_routing():
    assert is_routing_turn(_rec("네이버 뉴스 5개를 가져왔습니다...")) is False


def test_unrelated_json_is_not_routing():
    assert is_routing_turn(_rec('{"foo": 1, "bar": 2}')) is False


def test_routing_with_extra_keys_is_not_routing():
    # Never observed in real data but guard anyway — if the tag ever grows a
    # new key, we should notice, not silently filter.
    assert is_routing_turn(_rec('{"chat": 0.0, "do": 1.0, "spec": 0.0, "other": 0.0}')) is False


def test_routing_with_missing_key_is_not_routing():
    assert is_routing_turn(_rec('{"chat": 0.5, "do": 0.5}')) is False


def test_non_numeric_values_are_not_routing():
    assert is_routing_turn(_rec('{"chat": "high", "do": "low", "spec": "none"}')) is False


def test_boolean_values_are_not_routing():
    # Python treats True/False as int subclass; guard explicitly.
    assert is_routing_turn(_rec('{"chat": true, "do": false, "spec": true}')) is False


def test_very_long_response_is_not_routing_even_if_prefix_matches():
    # 200자 초과면 탐지 안 함 — 긴 응답은 반드시 실제 내용 포함
    resp = '{"chat": 0.0, "do": 1.0, "spec": 0.0}\n\n' + ('가' * 300)
    assert is_routing_turn(_rec(resp)) is False


def test_malformed_json_is_not_routing():
    assert is_routing_turn(_rec('{"chat": 0.0, "do": 1.0,}')) is False


def test_record_without_response_field_is_not_routing():
    assert is_routing_turn({}) is False
    assert is_routing_turn({"generateAssistantResponseEventResponse": {}}) is False
