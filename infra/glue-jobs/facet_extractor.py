"""facet_extractor — per-session Bedrock call producing a CC-style Facet JSON.

Facet schema ports Claude Code's `/insights` pipeline §2 (see
docs/reference/claude-code-insights-pipeline.md), with one difference: we
instruct the model to respond with Korean narrative text to match the dashboard
UI language. JSON keys and enum values remain English.

Pure functions (`format_session_transcript`, `build_facet_prompt`,
`parse_facet_json`, `is_valid_facet`) carry the deterministic logic and are
unit-tested without AWS. Bedrock I/O is injected via `bedrock_invoker`.
"""
import json
import re
from typing import Callable, Dict, List, Optional


# CC pipeline limits (§7). Kept in parity with the reference doc so facet
# quality matches.
USER_TRUNCATE = 500
ASSISTANT_TRUNCATE = 300
MIN_TURNS_FOR_FACET = 2

FACET_REQUIRED_FIELDS = (
    "underlying_goal",
    "outcome",
    "brief_summary",
    "goal_categories",
    "user_satisfaction_counts",
    "friction_counts",
    "user_instructions_to_kiro",
)


def _trunc(s: str, n: int) -> str:
    return s[:n] if len(s) > n else s


def format_session_transcript(
    *,
    session_id: str,
    turns: List[Dict[str, object]],
    tier: str,
    spec_name: Optional[str],
) -> str:
    """Format turns as a compact plain-text transcript for the LLM.

    Format mirrors `formatTranscriptForFacets` from CC (`insights.ts:831-868`)
    but adds our spec/day tier header so the model knows what kind of session
    it is evaluating.
    """
    head = f"Session: {session_id[:8]}\n"
    head += f"Type: {tier}"
    if spec_name:
        head += f" ({spec_name})"
    head += "\n"
    head += f"Turns: {len(turns)}\n\n"

    body_lines: List[str] = []
    for t in turns:
        ts = t.get("timestamp", "") or ""
        p = t.get("prompt", "") or ""
        r = t.get("assistant_response", "") or ""
        body_lines.append(f"[User]({ts}): {_trunc(p, USER_TRUNCATE)}")
        body_lines.append(f"[Assistant]: {_trunc(r, ASSISTANT_TRUNCATE)}")
    return head + "\n".join(body_lines)


def build_facet_prompt(session_text: str) -> str:
    """Return the final Bedrock user-message prompt for facet extraction.

    CC reference pipeline §2 verbatim, with an added Korean output directive
    for narrative fields (brief_summary, friction_detail, etc.).
    """
    return (
        "Analyze this Kiro session and extract structured facets.\n\n"
        "CRITICAL GUIDELINES:\n\n"
        "1. goal_categories: Count ONLY what the USER explicitly asked for.\n"
        "   - DO NOT count autonomous exploration.\n"
        "   - ONLY count when the user says 'can you...', 'please...', 'I need...', 'let's...'\n\n"
        "2. user_satisfaction_counts: Base ONLY on explicit user signals.\n"
        "   - '좋아요', 'great!', 'perfect!' → happy\n"
        "   - '감사', 'thanks', 'looks good' → satisfied\n"
        "   - 'ok, now let's...' (continuing without complaint) → likely_satisfied\n"
        "   - '틀렸어', 'try again' → dissatisfied\n"
        "   - 'this is broken', 'I give up' → frustrated\n\n"
        "3. friction_counts: Be specific about what went wrong.\n"
        "   - misunderstood_request | wrong_approach | buggy_code | user_rejected_action | excessive_changes\n\n"
        "4. user_instructions_to_kiro: Array of explicit instructions the user\n"
        "   gave to Kiro (e.g., '테스트 먼저 돌려', 'TypeScript strict 모드 유지').\n\n"
        "5. If the session is very short or just warmup, use warmup_minimal for goal_category.\n\n"
        f"SESSION:\n{session_text}\n\n"
        "LANGUAGE: Write every narrative text value (brief_summary, friction_detail, "
        "underlying_goal if phrased, and any free-text content) in Korean (한국어).\n"
        "JSON keys and enum values (outcome=fully_achieved|mostly_achieved|..., "
        "kiro_helpfulness=very_helpful|..., session_type=single_task|...) remain in English unchanged.\n\n"
        "RESPOND WITH ONLY A VALID JSON OBJECT matching this schema:\n"
        "{\n"
        '  "underlying_goal": "What the user fundamentally wanted to achieve (Korean)",\n'
        '  "goal_categories": {"category_name": count, ...},\n'
        '  "outcome": "fully_achieved|mostly_achieved|partially_achieved|not_achieved|unclear_from_transcript",\n'
        '  "user_satisfaction_counts": {"level": count, ...},\n'
        '  "kiro_helpfulness": "unhelpful|slightly_helpful|moderately_helpful|very_helpful|essential",\n'
        '  "session_type": "single_task|multi_task|iterative_refinement|exploration|quick_question",\n'
        '  "friction_counts": {"friction_type": count, ...},\n'
        '  "friction_detail": "One Korean sentence describing friction or empty",\n'
        '  "primary_success": "none|good_explanations|proactive_help|good_debugging",\n'
        '  "brief_summary": "One Korean sentence: what the user wanted and whether they got it",\n'
        '  "user_instructions_to_kiro": ["Korean instruction 1", "..."]\n'
        "}"
    )


_JSON_RE = re.compile(r"\{[\s\S]*\}")


def parse_facet_json(text: str) -> Optional[Dict[str, object]]:
    if not text:
        return None
    m = _JSON_RE.search(text)
    if not m:
        return None
    try:
        return json.loads(m.group(0))
    except Exception:
        return None


def is_valid_facet(obj: object) -> bool:
    if not isinstance(obj, dict):
        return False
    return all(k in obj for k in FACET_REQUIRED_FIELDS)


BedrockInvoker = Callable[[str], str]


def extract_facet_for_session(
    *,
    session: Dict[str, object],
    turns: List[Dict[str, object]],
    bedrock_invoker: BedrockInvoker,
) -> Optional[Dict[str, object]]:
    """Run the facet pipeline for a single session. Returns None when the
    session is too short, the LLM response can't be parsed, or schema fields
    are missing. Caller decides how to handle None (skip or retry).
    """
    if not turns or len(turns) < MIN_TURNS_FOR_FACET:
        return None
    text = format_session_transcript(
        session_id=str(session.get("session_id", "")),
        turns=turns,
        tier=str(session.get("tier", "DAY")),
        spec_name=session.get("spec_name") if isinstance(session.get("spec_name"), str) else None,
    )
    prompt = build_facet_prompt(text)
    try:
        raw = bedrock_invoker(prompt)
    except Exception:
        return None
    parsed = parse_facet_json(raw)
    if not is_valid_facet(parsed):
        return None
    return parsed
