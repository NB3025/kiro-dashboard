import gzip
import io
import json
from pathlib import Path
from unittest.mock import MagicMock

from prompt_etl import (
    parse_gz_bytes,
    split_prompt_and_tool_events,
    extract_prompt_facets,
    build_prompt_event_row,
    build_tool_event_row,
    dedupe_by_request_id,
    run_prompt_etl,
    PROMPT_EVENT_REQUIRED_COLUMNS,
    TOOL_EVENT_REQUIRED_COLUMNS,
)

FIXTURE = Path(__file__).resolve().parents[3] / "tests" / "fixtures" / "prompt-logs-sample.json"


def _gzip_bytes(payload: dict) -> bytes:
    buf = io.BytesIO()
    with gzip.GzipFile(fileobj=buf, mode="wb") as gz:
        gz.write(json.dumps(payload).encode("utf-8"))
    return buf.getvalue()


def test_parse_gz_bytes_returns_records_from_fixture():
    payload = json.loads(FIXTURE.read_text())
    data = _gzip_bytes(payload)

    records = parse_gz_bytes(data)

    assert isinstance(records, list)
    assert len(records) == len(payload["records"])
    # each record has at least a timestamp/userId/prompt-like structure
    first = records[0]
    assert "request" in first or "requestId" in first or "_scenario" in first


def test_split_prompt_and_tool_events_separates_by_empty_prompt():
    payload = json.loads(FIXTURE.read_text())
    records = payload["records"]

    prompt_events, tool_events = split_prompt_and_tool_events(records)

    # 17 non-empty prompts, 1 empty (tool-result turn) in the fixture.
    assert len(prompt_events) == 17
    assert len(tool_events) == 1
    assert len(prompt_events) + len(tool_events) == len(records)


def test_split_rejects_both_empty_and_missing_prompt_into_tool_events():
    records = [
        {"generateAssistantResponseEventRequest": {"prompt": "hello"}},
        {"generateAssistantResponseEventRequest": {"prompt": ""}},
        {"generateAssistantResponseEventRequest": {}},  # no prompt field
    ]
    prompt_events, tool_events = split_prompt_and_tool_events(records)
    assert len(prompt_events) == 1
    assert len(tool_events) == 2


def test_extract_prompt_facets_steering_rules():
    prompt = '<user-rule id="use-uv">Always use uv</user-rule>\nPlease add tests'
    facets = extract_prompt_facets(prompt)
    assert facets["steering_rules"] == [{"id": "use-uv", "content": "Always use uv"}]


def test_extract_prompt_facets_active_editor_file_and_workspace():
    prompt = (
        '<ACTIVE-EDITOR-FILE path="src/app/page.tsx">body</ACTIVE-EDITOR-FILE>\n'
        '<EnvironmentContext><workspace>/w</workspace></EnvironmentContext>\nquestion'
    )
    facets = extract_prompt_facets(prompt)
    assert facets["active_editor_file"] == "src/app/page.tsx"
    assert facets["workspace_path"] == "/w"


def test_extract_prompt_facets_client_type_cli_marker():
    assert extract_prompt_facets("--- USER MESSAGE BEGIN ---\nhi")["client_type"] == "CLI"
    assert extract_prompt_facets("regular IDE prompt")["client_type"] == "IDE"
    assert extract_prompt_facets("")["client_type"] == "UNKNOWN"


def test_extract_prompt_facets_spec_mode_requirements():
    facets = extract_prompt_facets(".kiro/specs/foo/requirements.md review")
    assert facets["is_spec_mode"] is True
    assert facets["active_spec_phase"] == "requirements"


def test_extract_prompt_facets_spec_mode_design_tasks_implementation_not_spec():
    assert extract_prompt_facets(".kiro/specs/x/design.md")["active_spec_phase"] == "design"
    assert extract_prompt_facets(".kiro/specs/x/tasks.md")["active_spec_phase"] == "tasks"
    assert extract_prompt_facets(".kiro/specs/x/notes.md")["active_spec_phase"] == "implementation"
    not_spec = extract_prompt_facets("normal question")
    assert not_spec["is_spec_mode"] is False
    assert not_spec["active_spec_phase"] == "not_spec"


def test_extract_prompt_facets_clean_prompt_strips_structural_tags():
    prompt = (
        '<user-rule id="r">always use uv</user-rule>\n'
        '<ACTIVE-EDITOR-FILE path="x">y</ACTIVE-EDITOR-FILE>\n'
        '<EnvironmentContext><workspace>/w</workspace></EnvironmentContext>\n'
        '--- USER MESSAGE BEGIN ---\nAsk the real question'
    )
    facets = extract_prompt_facets(prompt)
    clean = facets["clean_prompt"]
    assert "user-rule" not in clean
    assert "ACTIVE-EDITOR-FILE" not in clean
    assert "EnvironmentContext" not in clean
    assert "USER MESSAGE BEGIN" not in clean
    assert "Ask the real question" in clean


# FR-ETL-8 prompt_events schema


def test_prompt_event_required_columns_match_spec():
    assert PROMPT_EVENT_REQUIRED_COLUMNS == [
        "request_id",
        "user_id",
        "session_id",
        "timestamp",
        "date",
        "model_id",
        "chat_trigger_type",
        "client_type",
        "prompt_length",
        "response_length",
        "prompt",
        "clean_prompt",
        "steering_rules",
        "active_editor_file",
        "workspace_path",
        "is_spec_mode",
        "active_spec_phase",
        "active_spec_name",
        "schema_version",
    ]


def test_build_prompt_event_row_populates_all_required_columns():
    record = {
        "generateAssistantResponseEventRequest": {
            "prompt": "Hello",
            "modelId": "claude-sonnet-4-5",
            "chatTriggerType": "MANUAL",
            "userId": "u1",
            "timeStamp": "2026-05-03T09:05:00Z",
        },
        "generateAssistantResponseEventResponse": {
            "assistantResponse": "forty-two chars of assistant reply content",
            "requestId": "req-abc",
        },
    }
    row = build_prompt_event_row(record, session_id="sess-1234567890abcdef")

    assert set(PROMPT_EVENT_REQUIRED_COLUMNS).issubset(row.keys())
    assert row["request_id"] == "req-abc"
    assert row["user_id"] == "u1"
    assert row["session_id"] == "sess-1234567890abcdef"
    assert row["model_id"] == "claude-sonnet-4-5"
    assert row["chat_trigger_type"] == "MANUAL"
    assert row["client_type"] == "IDE"
    assert row["prompt_length"] == len("Hello")
    assert row["response_length"] == len("forty-two chars of assistant reply content")
    assert row["prompt"] == "Hello"
    assert row["clean_prompt"] == "Hello"
    assert row["steering_rules"] == []
    assert row["active_editor_file"] is None
    assert row["workspace_path"] is None
    assert row["is_spec_mode"] is False
    assert row["active_spec_phase"] == "not_spec"
    assert row["date"] == "2026-05-03"
    assert row["schema_version"] == "1.0.0"


def test_dedupe_by_request_id_removes_duplicates_keeping_first():
    rows = [
        {"request_id": "r1", "prompt": "A"},
        {"request_id": "r2", "prompt": "B"},
        {"request_id": "r1", "prompt": "duplicate"},
        {"request_id": "r3", "prompt": "C"},
    ]
    out = dedupe_by_request_id(rows)
    assert [r["request_id"] for r in out] == ["r1", "r2", "r3"]
    # First occurrence wins (content "A", not "duplicate")
    assert out[0]["prompt"] == "A"


def test_dedupe_is_idempotent_when_run_twice():
    rows = [
        {"request_id": "r1", "v": 1},
        {"request_id": "r2", "v": 2},
    ]
    once = dedupe_by_request_id(rows)
    twice = dedupe_by_request_id(once + rows)  # simulate second-pass concat
    assert [r["request_id"] for r in twice] == ["r1", "r2"]


# FR-ETL-8 / design §4.6: partition `date` by event timestamp (UTC).


def _record_with_ts(ts: str) -> dict:
    return {
        "generateAssistantResponseEventRequest": {
            "prompt": "x",
            "userId": "u",
            "modelId": "m",
            "timeStamp": ts,
        },
        "generateAssistantResponseEventResponse": {
            "assistantResponse": "",
            "requestId": "r-" + ts,
        },
    }


def test_build_prompt_event_row_date_for_midnight_utc_pre_and_post():
    # Two events straddling UTC midnight
    pre = build_prompt_event_row(_record_with_ts("2026-05-03T23:55:00Z"), session_id="s1")
    post = build_prompt_event_row(_record_with_ts("2026-05-04T00:05:00Z"), session_id="s1")
    assert pre["date"] == "2026-05-03"
    assert post["date"] == "2026-05-04"


def test_build_prompt_event_row_date_is_utc_not_local():
    # Deliberately past-midnight-local but pre-midnight-UTC timestamp;
    # we only accept ISO-Z strings so this just verifies we take the date slice.
    row = build_prompt_event_row(_record_with_ts("2026-05-03T23:30:00Z"), session_id="s1")
    assert row["date"] == "2026-05-03"


# FR-ETL-8 tool_events schema


def test_tool_event_required_columns_match_spec():
    assert TOOL_EVENT_REQUIRED_COLUMNS == [
        "request_id",
        "user_id",
        "timestamp",
        "date",
        "response_length",
        "schema_version",
    ]


def test_build_tool_event_row_returns_minimal_columns():
    record = {
        "generateAssistantResponseEventRequest": {
            "prompt": "",  # empty = tool turn
            "userId": "u1",
            "timeStamp": "2026-05-03T10:00:00Z",
        },
        "generateAssistantResponseEventResponse": {
            "assistantResponse": "x" * 120,
            "requestId": "tool-req-1",
        },
    }
    row = build_tool_event_row(record)
    assert set(TOOL_EVENT_REQUIRED_COLUMNS) == set(row.keys())
    assert row["request_id"] == "tool-req-1"
    assert row["user_id"] == "u1"
    assert row["timestamp"] == "2026-05-03T10:00:00Z"
    assert row["date"] == "2026-05-03"
    assert row["response_length"] == 120
    assert row["schema_version"] == "1.0.0"


def test_run_prompt_etl_reads_gz_and_writes_parquet_partitions():
    # Given: one .json.gz object in the source bucket containing 1 prompt + 1 tool event
    payload = {
        "records": [
            {
                "generateAssistantResponseEventRequest": {
                    "prompt": "hello world",
                    "userId": "u1",
                    "timeStamp": "2026-05-03T09:05:00Z",
                    "modelId": "anthropic.claude-sonnet-4-5-20250929-v1:0",
                    "chatTriggerType": "MANUAL",
                },
                "generateAssistantResponseEventResponse": {
                    "assistantResponse": "x" * 42,
                    "requestId": "rid-prompt-1",
                },
            },
            {
                "generateAssistantResponseEventRequest": {
                    "prompt": "",
                    "userId": "u1",
                    "timeStamp": "2026-05-03T09:06:00Z",
                },
                "generateAssistantResponseEventResponse": {
                    "assistantResponse": "x" * 7,
                    "requestId": "rid-tool-1",
                },
            },
        ]
    }
    gz_bytes = _gzip_bytes(payload)

    s3 = MagicMock()
    s3.get_paginator.return_value.paginate.return_value = [
        {"Contents": [{"Key": "prompt-logs/GenerateAssistantResponse_example.json.gz"}]}
    ]
    s3.get_object.return_value = {"Body": io.BytesIO(gz_bytes)}

    # When: run the ETL end-to-end
    run_prompt_etl(
        s3_client=s3,
        prompt_logs_bucket="test-kiro-logging-us-east-1",
        prompt_logs_prefix="prompt-logs",
        insights_bucket="kiro-insights-test",
        prompt_events_prefix="prompt_events",
        tool_events_prefix="tool_events",
    )

    # Then: Parquet writes land in date-partitioned keys
    put_keys = [c.kwargs["Key"] for c in s3.put_object.call_args_list]
    assert any(k.startswith("prompt_events/date=2026-05-03/") for k in put_keys), put_keys
    assert any(k.startswith("tool_events/date=2026-05-03/") for k in put_keys), put_keys


def test_run_prompt_etl_skips_non_gz_objects():
    s3 = MagicMock()
    s3.get_paginator.return_value.paginate.return_value = [
        {"Contents": [{"Key": "prompt-logs/readme.txt"}]}
    ]

    run_prompt_etl(
        s3_client=s3,
        prompt_logs_bucket="src",
        prompt_logs_prefix="prompt-logs",
        insights_bucket="dst",
    )

    assert s3.get_object.call_count == 0
    assert s3.put_object.call_count == 0
