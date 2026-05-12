"""facet_builder — Glue entry that reads sessions + prompt_events,
extracts Facet JSON per session via Bedrock, and writes to S3:

    insights/facets/session=<session_id>.json

Each facet file is small (~1-2 KB) and keyed by session_id so reprocessing
is idempotent: overwriting the same key produces identical output if the
underlying turns haven't changed.
"""
import io
import json
import os
import sys
from collections import defaultdict
from typing import Any, Dict, List, Optional

from facet_extractor import extract_facet_for_session


def _load_parquet_rows(s3_client: Any, bucket: str, prefix: str) -> List[Dict[str, Any]]:
    import pandas as pd

    rows: List[Dict[str, Any]] = []
    paginator = s3_client.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=bucket, Prefix=prefix):
        for obj in page.get("Contents", []) or []:
            key = obj["Key"]
            if not key.endswith(".parquet"):
                continue
            body = s3_client.get_object(Bucket=bucket, Key=key)["Body"].read()
            df = pd.read_parquet(io.BytesIO(body))
            rows.extend(df.to_dict("records"))
    return rows


def _ts_to_epoch(ts: str) -> int:
    # Mirrors session_builder._iso_to_epoch
    import re
    from datetime import datetime, timezone

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


def _partition_date(ts_epoch: int) -> str:
    from datetime import datetime, timezone
    return datetime.fromtimestamp(ts_epoch, tz=timezone.utc).strftime("%Y-%m-%d")


def _coerce_str(v: Any) -> Optional[str]:
    if v is None:
        return None
    if isinstance(v, str):
        return v
    try:
        import math
        if isinstance(v, float) and math.isnan(v):
            return None
    except Exception:
        pass
    return str(v)


def _session_key_for_event(event: Dict[str, Any]) -> str:
    """Recompute the same session key build_sessions used: (user_id, SPEC, spec_name)
    or (user_id, DAY, YYYY-MM-DD). Used to match each event back to its session."""
    import hashlib
    user_id = event["user_id"]
    spec = _coerce_str(event.get("active_spec_name"))
    if spec:
        parts = [user_id, "SPEC", spec]
    else:
        day = _partition_date(event["ts_epoch"])
        parts = [user_id, "DAY", day]
    h = hashlib.sha256("|".join(parts).encode("utf-8")).hexdigest()
    return h[:16]


def _group_events_by_session(events: List[Dict[str, Any]]) -> Dict[str, List[Dict[str, Any]]]:
    grouped: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for e in events:
        user_id = e.get("user_id") or e.get("userId")
        ts = e.get("ts_epoch")
        if ts is None:
            ts = _ts_to_epoch(e.get("timestamp", ""))
        if not user_id or not ts:
            continue
        norm = {
            "user_id": user_id,
            "ts_epoch": int(ts),
            "timestamp": e.get("timestamp"),
            "prompt": e.get("prompt", ""),
            "assistant_response": e.get("assistant_response", "") or e.get("clean_prompt", ""),
            "active_spec_name": _coerce_str(e.get("active_spec_name")),
        }
        sid = _session_key_for_event(norm)
        grouped[sid].append(norm)
    for sid in grouped:
        grouped[sid].sort(key=lambda x: x["ts_epoch"])
    return grouped


def _load_sessions(s3_client: Any, bucket: str, sessions_prefix: str) -> List[Dict[str, Any]]:
    return _load_parquet_rows(s3_client, bucket, sessions_prefix)


def _facet_key(session_id: str) -> str:
    return f"insights/facets/session={session_id}.json"


def _facet_exists(s3_client: Any, bucket: str, session_id: str) -> bool:
    try:
        s3_client.head_object(Bucket=bucket, Key=_facet_key(session_id))
        return True
    except Exception:
        return False


def build_bedrock_invoker(model_id: str, region: str):
    """Return a callable(prompt: str) -> str using the Bedrock Converse API."""
    import boto3

    client = boto3.client("bedrock-runtime", region_name=region)

    def invoker(prompt: str) -> str:
        resp = client.converse(
            modelId=model_id,
            messages=[{"role": "user", "content": [{"text": prompt}]}],
            inferenceConfig={"maxTokens": 4096},
        )
        # output.message.content[].text
        msg = resp.get("output", {}).get("message", {})
        for c in msg.get("content", []):
            if "text" in c:
                return c["text"]
        return ""

    return invoker


def run_facet_builder(
    *,
    s3_client: Any,
    insights_bucket: str,
    sessions_prefix: str = "sessions",
    prompt_events_prefix: str = "prompt_events",
    facets_prefix: str = "insights/facets",
    bedrock_invoker=None,
    skip_existing: bool = True,
) -> Dict[str, int]:
    """Main entry. Returns counters: {total, extracted, skipped_short, failed, already_cached}."""
    sessions = _load_sessions(s3_client, insights_bucket, sessions_prefix)
    events = _load_parquet_rows(s3_client, insights_bucket, prompt_events_prefix)
    events_by_sid = _group_events_by_session(events)

    counters = {
        "total": len(sessions),
        "extracted": 0,
        "skipped_short": 0,
        "failed": 0,
        "already_cached": 0,
    }

    for s in sessions:
        sid = s.get("session_id")
        if not sid:
            continue
        if skip_existing and _facet_exists(s3_client, insights_bucket, sid):
            counters["already_cached"] += 1
            continue
        turns = events_by_sid.get(sid, [])
        if len(turns) < 2:
            counters["skipped_short"] += 1
            continue
        facet = extract_facet_for_session(
            session=s,
            turns=turns,
            bedrock_invoker=bedrock_invoker,
        )
        if facet is None:
            counters["failed"] += 1
            continue
        facet["_session_id"] = sid
        facet["_tier"] = s.get("tier")
        facet["_spec_name"] = s.get("spec_name")
        facet["_user_id"] = s.get("user_id")
        s3_client.put_object(
            Bucket=insights_bucket,
            Key=f"{facets_prefix}/session={sid}.json",
            Body=json.dumps(facet, ensure_ascii=False).encode("utf-8"),
            ContentType="application/json",
        )
        counters["extracted"] += 1

    return counters


def main():
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
        raise RuntimeError("INSIGHTS_BUCKET must be provided via --INSIGHTS_BUCKET or env")

    model_id = kv.get("FACET_MODEL_ID") or os.environ.get("FACET_MODEL_ID") or "global.anthropic.claude-opus-4-7"
    region = kv.get("BEDROCK_REGION") or os.environ.get("BEDROCK_REGION") or "us-east-1"

    import boto3
    s3 = boto3.client("s3")
    invoker = build_bedrock_invoker(model_id, region)

    counters = run_facet_builder(
        s3_client=s3,
        insights_bucket=insights_bucket,
        bedrock_invoker=invoker,
    )
    print("[facet_builder]", json.dumps(counters))


if __name__ == "__main__":
    main()
