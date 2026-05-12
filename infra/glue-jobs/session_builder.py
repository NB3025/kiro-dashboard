"""Session builder — group prompt events into sessions using the workflow
rule (CLAUDE.md "Insights Pipeline Workflow" §1).

Rule:
  - active_spec_name present → session_key = (user_id, "SPEC", spec_name)
  - otherwise                → session_key = (user_id, "DAY", YYYY-MM-DD)

Session id = sha256(key parts joined by '|')[:16]. No time-based timeout.
A SPEC session may span arbitrarily many days; a DAY session collapses all
non-spec turns for that user on that UTC day.

Output is written to S3 as Parquet, partitioned by the UTC date of each
session's `start_ts` (key format: `<prefix>/date=YYYY-MM-DD/<session_id>.parquet`).
"""
import hashlib
import io
from collections import defaultdict
from datetime import datetime, timezone
from typing import Any, Dict, List


def _session_id(parts: List[str]) -> str:
    h = hashlib.sha256("|".join(parts).encode("utf-8")).hexdigest()
    return h[:16]


def build_sessions(events: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Spec-name-first / day-fallback session rule.

    Events must carry: user_id, ts_epoch, active_spec_name (str or None).
    """
    if not events:
        return []

    grouped: Dict[str, Dict[str, Any]] = {}

    for ev in events:
        user_id = ev["user_id"]
        ts = int(ev["ts_epoch"])
        spec = ev.get("active_spec_name")

        if spec:
            key_parts = [user_id, "SPEC", spec]
            tier = "SPEC"
            spec_name = spec
            day = None
        else:
            day = _partition_date(ts)
            key_parts = [user_id, "DAY", day]
            tier = "DAY"
            spec_name = None

        sid = _session_id(key_parts)
        if sid not in grouped:
            grouped[sid] = {
                "user_id": user_id,
                "session_id": sid,
                "tier": tier,
                "spec_name": spec_name,
                "day": day,
                "start_ts": ts,
                "end_ts": ts,
                "event_count": 0,
            }
        s = grouped[sid]
        s["event_count"] += 1
        if ts < s["start_ts"]:
            s["start_ts"] = ts
        if ts > s["end_ts"]:
            s["end_ts"] = ts

    # Preserve insertion order stably so tests that iterate over the list can
    # rely on first-seen ordering of unique session keys.
    return list(grouped.values())


def _partition_date(ts_epoch: int) -> str:
    return datetime.fromtimestamp(ts_epoch, tz=timezone.utc).strftime("%Y-%m-%d")


def _encode_parquet(sessions: List[Dict[str, Any]]) -> bytes:
    # Glue Python Shell jobs may not have pyarrow at runtime in tests; but the
    # dev env (pyproject.toml) installs it. Kept minimal here.
    import pandas as pd  # lazy import to keep module import cheap in tests

    df = pd.DataFrame(list(sessions))
    buf = io.BytesIO()
    df.to_parquet(buf, index=False)
    return buf.getvalue()


def _iso_to_epoch(ts: str) -> int:
    """Parse Kiro log timestamps (ISO 8601 with up to nanosecond fractional
    seconds and trailing 'Z'). Python 3.9's fromisoformat rejects 7+ digit
    fractional seconds, so truncate to microseconds first.
    """
    import re

    if not ts:
        return 0
    norm = ts.rstrip()
    if norm.endswith("Z"):
        norm = norm[:-1]
    norm = re.sub(r"(\.\d{6})\d+", r"\1", norm)
    try:
        dt = datetime.fromisoformat(norm)
    except ValueError:
        return 0

    return int(dt.replace(tzinfo=timezone.utc).timestamp())


def _read_prompt_events(s3_client: Any, bucket: str, prefix: str) -> List[Dict[str, Any]]:
    """Read prompt_events Parquet rows and normalize to {user_id, ts_epoch,
    active_spec_name}. Required for build_sessions (2-tier keying)."""
    import pandas as pd

    events: List[Dict[str, Any]] = []
    paginator = s3_client.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=bucket, Prefix=prefix):
        for obj in page.get("Contents", []) or []:
            key = obj["Key"]
            if not key.endswith(".parquet"):
                continue
            body = s3_client.get_object(Bucket=bucket, Key=key)["Body"].read()
            df = pd.read_parquet(io.BytesIO(body))
            for row in df.to_dict("records"):
                user_id = row.get("user_id") or row.get("userId") or ""
                if not user_id:
                    continue
                if "ts_epoch" in row:
                    ts_epoch = int(row["ts_epoch"])
                else:
                    ts_epoch = _iso_to_epoch(row.get("timestamp", ""))
                if ts_epoch == 0:
                    continue
                spec_name = row.get("active_spec_name")
                if spec_name is not None and not isinstance(spec_name, str):
                    # pandas may return float NaN for null string columns
                    try:
                        import math
                        if isinstance(spec_name, float) and math.isnan(spec_name):
                            spec_name = None
                    except Exception:
                        spec_name = None
                events.append({
                    "user_id": user_id,
                    "ts_epoch": ts_epoch,
                    "active_spec_name": spec_name,
                })
    return events


def write_sessions_to_s3(
    sessions: List[Dict[str, Any]],
    *,
    s3_client: Any,
    bucket: str,
    prefix: str,
) -> None:
    """Partition by start_ts date so Athena can still filter sessions by their
    first-seen day.
    """
    if not sessions:
        return

    by_date: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for s in sessions:
        by_date[_partition_date(s["start_ts"])].append(s)

    for date, rows in by_date.items():
        first_id = rows[0]["session_id"]
        key = f"{prefix}/date={date}/{first_id}.parquet"
        s3_client.put_object(
            Bucket=bucket,
            Key=key,
            Body=_encode_parquet(rows),
        )


def run_session_builder(
    *,
    s3_client: Any,
    insights_bucket: str,
    prompt_events_prefix: str = "prompt_events",
    sessions_prefix: str = "sessions",
) -> None:
    """Entry for spec-name/day 2-tier session keying. Writes to `sessions/`."""
    events = _read_prompt_events(s3_client, insights_bucket, prompt_events_prefix)
    sessions = build_sessions(events)
    write_sessions_to_s3(
        sessions,
        s3_client=s3_client,
        bucket=insights_bucket,
        prefix=sessions_prefix,
    )


def main():
    import os
    import sys

    import boto3

    # Glue Python Shell jobs pass job args via sys.argv as --KEY VALUE pairs.
    # Parse minimally without depending on awsglue.utils so this module stays
    # testable under the local pytest runner.
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

    insights_bucket = kv.get("INSIGHTS_BUCKET") or os.environ.get("INSIGHTS_BUCKET")
    if not insights_bucket:
        raise RuntimeError("INSIGHTS_BUCKET must be provided via --INSIGHTS_BUCKET arg or env")

    s3 = boto3.client("s3")
    run_session_builder(
        s3_client=s3,
        insights_bucket=insights_bucket,
    )


if __name__ == "__main__":
    main()
