"""Python port of lib/insights/prompt-parser.ts (FR-ETL-3 / FR-FACET-2).

MUST stay in lockstep with the TypeScript original. When changing a regex,
update both files; the TS tests in lib/insights/prompt-parser.test.ts are the
reference for expected behavior.
"""
import re
from typing import Dict, List, Literal, Optional, TypedDict

USER_RULE_RE = re.compile(r'<user-rule\s+id="([^"]+)">([\s\S]*?)</user-rule>')
# Two published formats:
#   1) Attribute form: <ACTIVE-EDITOR-FILE path="..."         (synthetic fixtures)
#   2) Nested-tag form: <ACTIVE-EDITOR-FILE>\n<file name="..."  (real Kiro logs)
ACTIVE_EDITOR_FILE_RE = re.compile(
    r'<ACTIVE-EDITOR-FILE(?:\s+path="([^"]+)"|>\s*<file\s+name="([^"]+)")'
)
WORKSPACE_RE = re.compile(r"<workspace>([^<]+)</workspace>")
SPEC_PATH_RE = re.compile(r"\.kiro/specs/[^/\s]+/([a-zA-Z0-9_-]+)\.md")
# Strict: captures <name> AND <phase> only when the active file itself is a
# spec document (not when the path merely appears inside prompt body).
ACTIVE_SPEC_RE = re.compile(
    r"\.kiro/specs/([^/\s]+)/(requirements|design|tasks|implementation)\.md$"
)

USER_RULE_STRIP_RE = re.compile(r'<user-rule\s+id="[^"]+">[\s\S]*?</user-rule>')
ENVIRONMENT_CONTEXT_STRIP_RE = re.compile(r"<EnvironmentContext>[\s\S]*?</EnvironmentContext>")
ACTIVE_EDITOR_FILE_STRIP_RE = re.compile(
    r"<ACTIVE-EDITOR-FILE[^>]*>[\s\S]*?</ACTIVE-EDITOR-FILE>"
)
CLI_MARKER_STRIP_RE = re.compile(r"--- (?:USER MESSAGE|CONTEXT ENTRY) (?:BEGIN|END) ---")


ClientType = Literal["CLI", "IDE", "UNKNOWN"]
SpecPhase = Literal["requirements", "design", "tasks", "implementation", "not_spec"]


class SteeringRule(TypedDict):
    id: str
    content: str


def extract_steering_rules(prompt: str) -> List[SteeringRule]:
    if not prompt:
        return []
    return [
        {"id": m.group(1), "content": m.group(2).strip()}
        for m in USER_RULE_RE.finditer(prompt)
    ]


def extract_active_editor_file(prompt: str) -> Optional[str]:
    if not prompt:
        return None
    m = ACTIVE_EDITOR_FILE_RE.search(prompt)
    if not m:
        return None
    # Return whichever alternative captured (attribute form or nested-file form).
    return m.group(1) or m.group(2)


def extract_workspace_path(prompt: str) -> Optional[str]:
    if not prompt:
        return None
    m = WORKSPACE_RE.search(prompt)
    return m.group(1) if m else None


def detect_client_type(prompt: str) -> ClientType:
    if not prompt:
        return "UNKNOWN"
    if "--- USER MESSAGE BEGIN ---" in prompt:
        return "CLI"
    if "--- CONTEXT ENTRY BEGIN ---" in prompt:
        return "CLI"
    return "IDE"


def detect_spec_mode(prompt: str) -> Dict[str, object]:
    """Classify spec mode + extract active_spec_name (1st-tier session key).

    active_spec_name is set ONLY when the user is actively editing a spec
    document (active_file is `.kiro/specs/<name>/{requirements|design|tasks
    |implementation}.md`). Mere text references to a spec path do not count —
    we want to cluster sessions by what the user is working on.
    """
    if not prompt or ".kiro/specs/" not in prompt:
        return {"is_spec_mode": False, "active_spec_phase": "not_spec", "active_spec_name": None}

    active_file = extract_active_editor_file(prompt) or ""
    active_match = ACTIVE_SPEC_RE.search(active_file)
    active_spec_name = active_match.group(1) if active_match else None
    active_phase = active_match.group(2) if active_match else None

    # Preserve the legacy `active_spec_phase` behaviour (derived from any spec
    # path reference in the prompt body) for backwards compatibility.
    m = SPEC_PATH_RE.search(prompt)
    if m and m.group(1) in ("requirements", "design", "tasks"):
        phase_from_body = m.group(1)
    else:
        phase_from_body = "implementation"

    return {
        "is_spec_mode": True,
        "active_spec_phase": active_phase or phase_from_body,
        "active_spec_name": active_spec_name,
    }


def clean_prompt(prompt: str) -> str:
    if not prompt:
        return ""
    out = USER_RULE_STRIP_RE.sub("", prompt)
    out = ENVIRONMENT_CONTEXT_STRIP_RE.sub("", out)
    out = ACTIVE_EDITOR_FILE_STRIP_RE.sub("", out)
    out = CLI_MARKER_STRIP_RE.sub("", out)
    return out.strip()
