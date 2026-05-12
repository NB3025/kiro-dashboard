"""Tests for build_sessions — spec-name-first / day-fallback session rule.

Rule:
  1. If active_spec_name is present: session_key = (user_id, "SPEC", spec_name)
  2. Else:                            session_key = (user_id, "DAY", YYYY-MM-DD)

Session id = sha256(session_key joined by '|')[0:16].

No time-based timeout. A spec session may span multiple days.
"""

import io
import re
from unittest.mock import MagicMock

from session_builder import build_sessions, run_session_builder


def test_v2_suffixed_symbols_never_return():
    """The transitional v2-suffixed names were renamed to the canonical form
    (2026-05-12) once v1 was removed. Guard against them resurfacing (e.g.
    accidental revert). Note: `_session_id` itself is the current helper —
    the old v1 `_session_id(user_id, start_ts)` signature is different but
    the name collided, so guarding the name directly is not helpful."""
    import session_builder as sb
    for removed in (
        "build_sessions_v2",
        "run_session_builder_v2",
        "write_sessions_v2_to_s3",
        "_session_id_v2",
        "_read_prompt_events_v2",
    ):
        assert not hasattr(sb, removed), f"{removed} should not exist in session_builder"


def test_empty_returns_empty():
    assert build_sessions([]) == []


def test_single_spec_event_produces_spec_session():
    events = [{
        "user_id": "u1",
        "ts_epoch": 1_700_000_000,
        "active_spec_name": "my-project",
    }]
    sessions = build_sessions(events)
    assert len(sessions) == 1
    s = sessions[0]
    assert s["user_id"] == "u1"
    assert s["tier"] == "SPEC"
    assert s["spec_name"] == "my-project"
    assert s["event_count"] == 1
    assert re.fullmatch(r"[0-9a-f]{16}", s["session_id"])


def test_single_non_spec_event_produces_day_session():
    # 1_700_000_000 = 2023-11-14 22:13:20 UTC (day boundary check)
    events = [{"user_id": "u1", "ts_epoch": 1_700_000_000, "active_spec_name": None}]
    sessions = build_sessions(events)
    assert len(sessions) == 1
    s = sessions[0]
    assert s["tier"] == "DAY"
    assert s["day"] == "2023-11-14"


def test_spec_merges_across_days_for_same_user_and_spec():
    t0 = 1_700_000_000
    events = [
        {"user_id": "u1", "ts_epoch": t0, "active_spec_name": "my-project"},
        {"user_id": "u1", "ts_epoch": t0 + 3 * 86400, "active_spec_name": "my-project"},
        {"user_id": "u1", "ts_epoch": t0 + 30 * 86400, "active_spec_name": "my-project"},
    ]
    sessions = build_sessions(events)
    assert len(sessions) == 1
    assert sessions[0]["tier"] == "SPEC"
    assert sessions[0]["event_count"] == 3


def test_different_specs_same_user_produce_two_sessions():
    t0 = 1_700_000_000
    events = [
        {"user_id": "u1", "ts_epoch": t0, "active_spec_name": "my-project"},
        {"user_id": "u1", "ts_epoch": t0 + 60, "active_spec_name": "mail-hunter"},
    ]
    sessions = build_sessions(events)
    assert len(sessions) == 2
    by_spec = {s["spec_name"]: s for s in sessions}
    assert "my-project" in by_spec
    assert "mail-hunter" in by_spec


def test_same_day_non_spec_events_collapse_into_single_day_session():
    t0 = 1_700_000_000  # 2023-11-14 22:13:20 UTC
    events = [
        {"user_id": "u1", "ts_epoch": t0, "active_spec_name": None},
        {"user_id": "u1", "ts_epoch": t0 + 60, "active_spec_name": None},
        {"user_id": "u1", "ts_epoch": t0 + 30 * 60, "active_spec_name": None},
    ]
    sessions = build_sessions(events)
    assert len(sessions) == 1
    assert sessions[0]["tier"] == "DAY"
    assert sessions[0]["event_count"] == 3


def test_day_boundary_splits_non_spec_events():
    # 22:13:20 UTC on 2023-11-14 + 3 hours = 01:13:20 on 2023-11-15
    t0 = 1_700_000_000
    events = [
        {"user_id": "u1", "ts_epoch": t0, "active_spec_name": None},
        {"user_id": "u1", "ts_epoch": t0 + 3 * 3600, "active_spec_name": None},
    ]
    sessions = build_sessions(events)
    assert len(sessions) == 2
    days = sorted(s["day"] for s in sessions)
    assert days == ["2023-11-14", "2023-11-15"]


def test_spec_and_non_spec_same_day_are_separate_sessions():
    t0 = 1_700_000_000
    events = [
        {"user_id": "u1", "ts_epoch": t0, "active_spec_name": "my-project"},
        {"user_id": "u1", "ts_epoch": t0 + 60, "active_spec_name": None},
        {"user_id": "u1", "ts_epoch": t0 + 120, "active_spec_name": "my-project"},
    ]
    sessions = build_sessions(events)
    assert len(sessions) == 2
    tiers = sorted(s["tier"] for s in sessions)
    assert tiers == ["DAY", "SPEC"]
    spec = next(s for s in sessions if s["tier"] == "SPEC")
    assert spec["event_count"] == 2  # the two spec turns merged
    day = next(s for s in sessions if s["tier"] == "DAY")
    assert day["event_count"] == 1


def test_different_users_never_share_sessions():
    t0 = 1_700_000_000
    events = [
        {"user_id": "A", "ts_epoch": t0, "active_spec_name": "my-project"},
        {"user_id": "B", "ts_epoch": t0 + 60, "active_spec_name": "my-project"},
    ]
    sessions = build_sessions(events)
    assert len(sessions) == 2
    assert sessions[0]["session_id"] != sessions[1]["session_id"]


def test_session_id_is_deterministic_for_same_key():
    events = [{"user_id": "u1", "ts_epoch": 1_700_000_000, "active_spec_name": "X"}]
    a = build_sessions(events)[0]["session_id"]
    b = build_sessions(events)[0]["session_id"]
    assert a == b


def test_start_and_end_ts_span_spec_session():
    t0 = 1_700_000_000
    events = [
        {"user_id": "u1", "ts_epoch": t0, "active_spec_name": "my-project"},
        {"user_id": "u1", "ts_epoch": t0 + 5 * 86400, "active_spec_name": "my-project"},
        {"user_id": "u1", "ts_epoch": t0 + 2 * 86400, "active_spec_name": "my-project"},
    ]
    sessions = build_sessions(events)
    assert len(sessions) == 1
    s = sessions[0]
    assert s["start_ts"] == t0
    assert s["end_ts"] == t0 + 5 * 86400


def test_output_fields_present_for_both_tiers():
    events = [
        {"user_id": "u1", "ts_epoch": 1_700_000_000, "active_spec_name": "my-project"},
        {"user_id": "u1", "ts_epoch": 1_700_000_100, "active_spec_name": None},
    ]
    sessions = build_sessions(events)
    for s in sessions:
        assert "user_id" in s
        assert "session_id" in s
        assert "tier" in s
        assert "start_ts" in s
        assert "end_ts" in s
        assert "event_count" in s
        assert "spec_name" in s  # None for DAY tier
        assert "day" in s        # None for SPEC tier


def _fake_events_parquet(rows):
    import pandas as pd
    buf = io.BytesIO()
    pd.DataFrame(rows).to_parquet(buf, index=False)
    return buf.getvalue()


def test_run_session_builder_reads_active_spec_name_from_parquet():
    events_bytes = _fake_events_parquet([
        {"user_id": "u1", "timestamp": "2026-05-03T09:00:00Z", "active_spec_name": "my-project"},
        {"user_id": "u1", "timestamp": "2026-05-10T09:00:00Z", "active_spec_name": "my-project"},
        {"user_id": "u1", "timestamp": "2026-05-03T10:00:00Z", "active_spec_name": None},
    ])
    s3 = MagicMock()
    s3.get_paginator.return_value.paginate.return_value = [
        {"Contents": [{"Key": "prompt_events/date=2026-05-03/part-0.parquet"}]}
    ]
    s3.get_object.return_value = {"Body": io.BytesIO(events_bytes)}

    run_session_builder(
        s3_client=s3,
        insights_bucket="kiro-insights-test",
        prompt_events_prefix="prompt_events",
        sessions_prefix="sessions",
    )

    # Partition by start_ts date → both start on 2026-05-03 → single put.
    put_calls = s3.put_object.call_args_list
    assert all(c.kwargs["Key"].startswith("sessions/date=2026-05-03/") for c in put_calls)
    assert len(put_calls) == 1
    import io as _io
    import pandas as pd
    df = pd.read_parquet(_io.BytesIO(put_calls[0].kwargs["Body"]))
    rows = df.to_dict("records")
    assert len(rows) == 2
    tiers = sorted(r["tier"] for r in rows)
    assert tiers == ["DAY", "SPEC"]
    spec = next(r for r in rows if r["tier"] == "SPEC")
    assert spec["event_count"] == 2
    assert spec["spec_name"] == "my-project"
