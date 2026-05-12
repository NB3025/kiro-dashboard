"""End-to-end tests for facet_builder.run_facet_builder with mocked S3 and
Bedrock invoker. Verifies counters and S3 writes."""
import io
import json
from unittest.mock import MagicMock

from facet_builder import run_facet_builder


def _parquet_of(rows):
    import pandas as pd
    buf = io.BytesIO()
    pd.DataFrame(rows).to_parquet(buf, index=False)
    return buf.getvalue()


def _mock_s3_with_sessions_and_events(session_rows, event_rows):
    s3 = MagicMock()
    sessions_bytes = _parquet_of(session_rows)
    events_bytes = _parquet_of(event_rows)

    def paginate_side_effect(Bucket, Prefix):
        if Prefix.startswith("sessions"):
            return [{"Contents": [{"Key": "sessions/date=2026-05-03/s.parquet"}]}]
        else:
            return [{"Contents": [{"Key": "prompt_events/date=2026-05-03/e.parquet"}]}]

    s3.get_paginator.return_value.paginate.side_effect = paginate_side_effect

    def get_object_side_effect(Bucket, Key):
        if "sessions" in Key:
            return {"Body": io.BytesIO(sessions_bytes)}
        else:
            return {"Body": io.BytesIO(events_bytes)}

    s3.get_object.side_effect = get_object_side_effect

    # No cached facets — head_object raises
    s3.head_object.side_effect = Exception("NotFound")

    return s3


def test_run_facet_builder_extracts_facet_for_valid_spec_session():
    # Precompute the expected session_id from build_sessions key rule
    import hashlib
    expected_sid = hashlib.sha256("|".join(["u1", "SPEC", "my-project"]).encode()).hexdigest()[:16]
    session = {
        "session_id": expected_sid,
        "user_id": "u1",
        "tier": "SPEC",
        "spec_name": "my-project",
        "start_ts": 1_700_000_000,
    }
    # Three turns all with active_spec_name=my-project so they hash to the same session_id.
    events = [
        {"user_id": "u1", "timestamp": "2026-05-03T09:00:00Z",
         "active_spec_name": "my-project", "prompt": "안녕", "clean_prompt": "안녕"},
        {"user_id": "u1", "timestamp": "2026-05-03T09:05:00Z",
         "active_spec_name": "my-project", "prompt": "확인", "clean_prompt": "확인"},
        {"user_id": "u1", "timestamp": "2026-05-03T09:10:00Z",
         "active_spec_name": "my-project", "prompt": "끝", "clean_prompt": "끝"},
    ]
    s3 = _mock_s3_with_sessions_and_events([session], events)

    good_facet = json.dumps({
        "underlying_goal": "테스트",
        "outcome": "fully_achieved",
        "brief_summary": "간단한 3턴 세션",
        "goal_categories": {"chat": 3},
        "user_satisfaction_counts": {},
        "friction_counts": {},
        "user_instructions_to_kiro": [],
    })
    counters = run_facet_builder(
        s3_client=s3,
        insights_bucket="test-bucket",
        bedrock_invoker=lambda p: good_facet,
    )

    assert counters["total"] == 1
    assert counters["extracted"] == 1
    assert counters["skipped_short"] == 0
    assert counters["failed"] == 0

    # Verify S3 put_object was called with correct key
    put_calls = s3.put_object.call_args_list
    assert len(put_calls) == 1
    assert put_calls[0].kwargs["Key"] == f"insights/facets/session={expected_sid}.json"
    body = put_calls[0].kwargs["Body"]
    body_str = body.decode("utf-8") if isinstance(body, bytes) else body
    obj = json.loads(body_str)
    assert obj["brief_summary"] == "간단한 3턴 세션"
    assert obj["_session_id"] == expected_sid
    assert obj["_tier"] == "SPEC"


def test_run_facet_builder_skips_short_sessions():
    import hashlib
    sid = hashlib.sha256("|".join(["u1", "DAY", "2026-05-03"]).encode()).hexdigest()[:16]
    session = {"session_id": sid, "user_id": "u1", "tier": "DAY",
               "spec_name": None, "start_ts": 1_746_230_400}
    # Only 1 event → below MIN_TURNS_FOR_FACET=2
    events = [{"user_id": "u1", "timestamp": "2026-05-03T12:00:00Z",
               "active_spec_name": None, "prompt": "hi", "clean_prompt": "hi"}]
    s3 = _mock_s3_with_sessions_and_events([session], events)

    counters = run_facet_builder(
        s3_client=s3,
        insights_bucket="test-bucket",
        bedrock_invoker=lambda p: "should not be called",
    )
    assert counters["skipped_short"] == 1
    assert counters["extracted"] == 0
    assert s3.put_object.call_count == 0


def test_run_facet_builder_increments_failed_on_bad_response():
    import hashlib
    sid = hashlib.sha256("|".join(["u1", "SPEC", "x"]).encode()).hexdigest()[:16]
    session = {"session_id": sid, "user_id": "u1", "tier": "SPEC",
               "spec_name": "x", "start_ts": 1_700_000_000}
    events = [
        {"user_id": "u1", "timestamp": "2026-05-03T09:00:00Z",
         "active_spec_name": "x", "prompt": "a", "clean_prompt": "a"},
        {"user_id": "u1", "timestamp": "2026-05-03T09:05:00Z",
         "active_spec_name": "x", "prompt": "b", "clean_prompt": "b"},
    ]
    s3 = _mock_s3_with_sessions_and_events([session], events)

    counters = run_facet_builder(
        s3_client=s3,
        insights_bucket="test-bucket",
        bedrock_invoker=lambda p: "not valid json",
    )
    assert counters["failed"] == 1
    assert counters["extracted"] == 0


def test_run_facet_builder_skips_already_cached_when_skip_existing_true():
    import hashlib
    sid = hashlib.sha256("|".join(["u1", "SPEC", "x"]).encode()).hexdigest()[:16]
    session = {"session_id": sid, "user_id": "u1", "tier": "SPEC",
               "spec_name": "x", "start_ts": 1_700_000_000}
    events = [
        {"user_id": "u1", "timestamp": "t1",
         "active_spec_name": "x", "prompt": "a", "clean_prompt": "a"},
        {"user_id": "u1", "timestamp": "t2",
         "active_spec_name": "x", "prompt": "b", "clean_prompt": "b"},
    ]
    s3 = _mock_s3_with_sessions_and_events([session], events)
    s3.head_object.side_effect = None
    s3.head_object.return_value = {"ContentLength": 1234}

    counters = run_facet_builder(
        s3_client=s3,
        insights_bucket="test-bucket",
        bedrock_invoker=lambda p: (_ for _ in ()).throw(Exception("should not be called")),
    )
    assert counters["already_cached"] == 1
    assert counters["extracted"] == 0
