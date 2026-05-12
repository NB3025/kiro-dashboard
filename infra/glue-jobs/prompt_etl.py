"""prompt_etl — parse Kiro GenerateAssistantResponse*.json.gz logs.

FR-ETL-1/2/3/5/8: read gzipped JSON payloads, split prompt vs tool-result turns,
extract structured facets from prompts, and write partitioned Parquet.
"""
import gzip
import io
import json
import re
from collections import defaultdict
from typing import List, Dict, Any, Tuple

from prompt_parser import (
    extract_steering_rules,
    extract_active_editor_file,
    extract_workspace_path,
    detect_client_type,
    detect_spec_mode,
    clean_prompt,
)


def parse_gz_bytes(data: bytes) -> List[Dict[str, Any]]:
    """Decode gzip payload and return the `records` array."""
    decoded = gzip.decompress(data).decode("utf-8")
    obj = json.loads(decoded)
    records = obj.get("records", [])
    if not isinstance(records, list):
        raise ValueError(f"expected 'records' to be a list, got {type(records).__name__}")
    return records


def _record_prompt(record: Dict[str, Any]) -> str:
    return (
        record.get("generateAssistantResponseEventRequest", {})
        .get("prompt", "")
    )


# Kiro's internal router emits a chat/do/spec classification tag as a
# standalone assistant response. The routing value is not user-facing and
# pollutes downstream analytics (inflates session/turn counts, confuses the
# Facet extractor into hallucinating "echo" frictions). Rule verified
# against 165 real raw samples (see /tmp/kiro-stage0 analysis):
#   - 154 pure routing tags (with or without ```json fence) → filter out
#   - 11 mixed turns where the tag is followed/preceded by real work → keep
_FENCE_RE = re.compile(r"^```(?:json)?\s*(\{[\s\S]*?\})\s*```\s*$")
_ROUTING_MAX_LEN = 200  # empirically routing tags are ≤ ~60 chars


def is_routing_turn(record: Dict[str, Any]) -> bool:
    """Return True iff the assistant response is a bare Kiro router tag.

    Detection: response (after trim) must be exactly a JSON object with keys
    {chat, do, spec} and numeric values. A surrounding ```json fence is
    allowed. Anything else — leading/trailing text, extra keys, non-numeric
    values — disqualifies.
    """
    resp = (
        record.get("generateAssistantResponseEventResponse", {}) or {}
    ).get("assistantResponse", "")
    if not resp or not isinstance(resp, str):
        return False
    stripped = resp.strip()
    if not stripped or len(stripped) > _ROUTING_MAX_LEN:
        return False

    fence = _FENCE_RE.match(stripped)
    if fence:
        candidate = fence.group(1)
    else:
        # Bare form: trimmed response must be exactly a JSON object.
        if not (stripped.startswith("{") and stripped.endswith("}")):
            return False
        candidate = stripped

    try:
        obj = json.loads(candidate)
    except (ValueError, json.JSONDecodeError):
        return False
    if not isinstance(obj, dict):
        return False
    if set(obj.keys()) != {"chat", "do", "spec"}:
        return False
    for v in obj.values():
        # bool is a subclass of int — reject explicitly.
        if isinstance(v, bool) or not isinstance(v, (int, float)):
            return False
    return True


def split_prompt_and_tool_events(
    records: List[Dict[str, Any]],
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """Partition records by whether the user-supplied prompt is non-empty.

    FR-ETL-2 / SC5: tool-result turns have empty prompts and go into tool_events;
    actual user prompts go into prompt_events.
    """
    prompt_events: List[Dict[str, Any]] = []
    tool_events: List[Dict[str, Any]] = []
    for r in records:
        # Drop Kiro internal routing tag turns — they are not meaningful
        # user/assistant interactions and must never reach prompt_events
        # or tool_events (see is_routing_turn for the detection rule).
        if is_routing_turn(r):
            continue
        if _record_prompt(r):
            prompt_events.append(r)
        else:
            tool_events.append(r)
    return prompt_events, tool_events


def extract_prompt_facets(prompt: str) -> Dict[str, Any]:
    """Run the full parser suite against a single user prompt and return a dict
    of structured facets suitable for a prompt_events Parquet row.
    """
    spec = detect_spec_mode(prompt)
    return {
        "steering_rules": extract_steering_rules(prompt),
        "active_editor_file": extract_active_editor_file(prompt),
        "workspace_path": extract_workspace_path(prompt),
        "client_type": detect_client_type(prompt),
        "is_spec_mode": spec["is_spec_mode"],
        "active_spec_phase": spec["active_spec_phase"],
        "active_spec_name": spec["active_spec_name"],
        "clean_prompt": clean_prompt(prompt),
    }


SCHEMA_VERSION = "1.0.0"

PROMPT_EVENT_REQUIRED_COLUMNS: List[str] = [
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

TOOL_EVENT_REQUIRED_COLUMNS: List[str] = [
    "request_id",
    "user_id",
    "timestamp",
    "date",
    "response_length",
    "schema_version",
]


def _date_from_iso(ts: str) -> str:
    # Expected form 2026-05-03T09:05:00Z — take the YYYY-MM-DD prefix.
    if not ts:
        return ""
    return ts[:10]


def dedupe_by_request_id(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """FR-ETL-5: idempotent overwrite via request_id dedup (first wins)."""
    seen = set()
    result: List[Dict[str, Any]] = []
    for row in rows:
        rid = row.get("request_id")
        if rid in seen:
            continue
        seen.add(rid)
        result.append(row)
    return result


def _extract_request_id(record: Dict[str, Any]) -> str:
    """Request ID is published under generateAssistantResponseEventResponse
    in the real Kiro log schema (not at record top-level). Fall back to the
    top-level field for compatibility with synthetic fixtures.
    """
    resp = record.get("generateAssistantResponseEventResponse", {}) or {}
    return resp.get("requestId") or record.get("requestId", "") or ""


def _response_length(record: Dict[str, Any]) -> int:
    """Kiro logs expose `assistantResponse` (string) rather than a pre-computed
    `responseLength` counter. Compute the character length on the fly and fall
    back to `responseLength` for fixtures that still carry it.
    """
    resp = record.get("generateAssistantResponseEventResponse", {}) or {}
    if "assistantResponse" in resp and isinstance(resp["assistantResponse"], str):
        return len(resp["assistantResponse"])
    return int(resp.get("responseLength", 0) or 0)


def build_tool_event_row(record: Dict[str, Any]) -> Dict[str, Any]:
    """Minimal row for tool-result (empty-prompt) turns."""
    req = record.get("generateAssistantResponseEventRequest", {})
    timestamp = req.get("timeStamp", "")
    return {
        "request_id": _extract_request_id(record),
        "user_id": req.get("userId", ""),
        "timestamp": timestamp,
        "date": _date_from_iso(timestamp),
        "response_length": _response_length(record),
        "schema_version": SCHEMA_VERSION,
    }


def build_prompt_event_row(record: Dict[str, Any], *, session_id: str) -> Dict[str, Any]:
    """Convert a raw fixture-shaped record into a prompt_events Parquet row."""
    req = record.get("generateAssistantResponseEventRequest", {})
    prompt = req.get("prompt", "")
    facets = extract_prompt_facets(prompt)
    timestamp = req.get("timeStamp", "")
    row = {
        "request_id": _extract_request_id(record),
        "user_id": req.get("userId", ""),
        "session_id": session_id,
        "timestamp": timestamp,
        "date": _date_from_iso(timestamp),
        "model_id": req.get("modelId", ""),
        "chat_trigger_type": req.get("chatTriggerType", ""),
        "client_type": facets["client_type"],
        "prompt_length": len(prompt),
        "response_length": _response_length(record),
        "prompt": prompt,
        "clean_prompt": facets["clean_prompt"],
        "steering_rules": facets["steering_rules"],
        "active_editor_file": facets["active_editor_file"],
        "workspace_path": facets["workspace_path"],
        "is_spec_mode": facets["is_spec_mode"],
        "active_spec_phase": facets["active_spec_phase"],
        "active_spec_name": facets["active_spec_name"],
        "schema_version": SCHEMA_VERSION,
    }
    return row


def _encode_parquet(rows: List[Dict[str, Any]]) -> bytes:
    import pandas as pd

    buf = io.BytesIO()
    pd.DataFrame(rows).to_parquet(buf, index=False)
    return buf.getvalue()


def _write_partitioned(
    rows: List[Dict[str, Any]],
    *,
    s3_client: Any,
    bucket: str,
    prefix: str,
) -> None:
    if not rows:
        return
    by_date: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for r in rows:
        by_date[r.get("date", "unknown")].append(r)
    for date, partition_rows in by_date.items():
        first_rid = partition_rows[0].get("request_id", "part")
        key = f"{prefix}/date={date}/{first_rid}.parquet"
        s3_client.put_object(Bucket=bucket, Key=key, Body=_encode_parquet(partition_rows))


def _ts_to_epoch(ts: str) -> int:
    from datetime import datetime

    # Expected ISO 8601 with trailing Z (UTC).
    if not ts:
        return 0
    try:
        return int(datetime.fromisoformat(ts.replace("Z", "+00:00")).timestamp())
    except ValueError:
        return 0


def run_prompt_etl(
    *,
    s3_client: Any,
    prompt_logs_bucket: str,
    prompt_logs_prefix: str,
    insights_bucket: str,
    prompt_events_prefix: str = "prompt_events",
    tool_events_prefix: str = "tool_events",
) -> None:
    """Scan the prompt-logs bucket, parse every *.json.gz, and write Parquet
    partitions to the insights bucket.

    Session IDs are computed on-the-fly per (user_id, timestamp) using the same
    sha256 hashing as session_builder so downstream joins work without a prior
    Glue run. The dedicated session_builder job still owns the canonical
    sessions table; here we only need a stable key per prompt event.
    """
    import hashlib

    prompt_rows: List[Dict[str, Any]] = []
    tool_rows: List[Dict[str, Any]] = []

    paginator = s3_client.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=prompt_logs_bucket, Prefix=prompt_logs_prefix):
        for obj in page.get("Contents", []) or []:
            key = obj["Key"]
            if not key.endswith(".json.gz"):
                continue
            body = s3_client.get_object(Bucket=prompt_logs_bucket, Key=key)["Body"].read()
            records = parse_gz_bytes(body)
            prompt_recs, tool_recs = split_prompt_and_tool_events(records)
            for pr in prompt_recs:
                req = pr.get("generateAssistantResponseEventRequest", {})
                ts_epoch = _ts_to_epoch(req.get("timeStamp", ""))
                user_id = req.get("userId", "")
                sid = hashlib.sha256(f"{user_id}|{ts_epoch}".encode("utf-8")).hexdigest()[:16]
                prompt_rows.append(build_prompt_event_row(pr, session_id=sid))
            for tr in tool_recs:
                tool_rows.append(build_tool_event_row(tr))

    prompt_rows = dedupe_by_request_id(prompt_rows)
    tool_rows = dedupe_by_request_id(tool_rows)

    _write_partitioned(
        prompt_rows,
        s3_client=s3_client,
        bucket=insights_bucket,
        prefix=prompt_events_prefix,
    )
    _write_partitioned(
        tool_rows,
        s3_client=s3_client,
        bucket=insights_bucket,
        prefix=tool_events_prefix,
    )


def main():
    import os
    import sys

    import boto3

    argv = sys.argv[1:]
    kv: Dict[str, str] = {}
    i = 0
    while i < len(argv):
        token = argv[i]
        if token.startswith("--") and i + 1 < len(argv):
            kv[token[2:]] = argv[i + 1]
            i += 2
        else:
            i += 1

    prompt_logs_bucket = kv.get("PROMPT_LOGS_BUCKET") or os.environ.get("PROMPT_LOGS_BUCKET")
    prompt_logs_prefix = (
        kv.get("PROMPT_LOGS_PREFIX")
        or os.environ.get("PROMPT_LOGS_PREFIX")
        or "kiro-logging/AWSLogs"
    )
    insights_bucket = kv.get("INSIGHTS_BUCKET") or os.environ.get("INSIGHTS_BUCKET")

    if not prompt_logs_bucket or not insights_bucket:
        raise RuntimeError(
            "PROMPT_LOGS_BUCKET and INSIGHTS_BUCKET must be provided via --KEY VALUE or env"
        )

    s3 = boto3.client("s3")
    run_prompt_etl(
        s3_client=s3,
        prompt_logs_bucket=prompt_logs_bucket,
        prompt_logs_prefix=prompt_logs_prefix,
        insights_bucket=insights_bucket,
    )


if __name__ == "__main__":
    main()
