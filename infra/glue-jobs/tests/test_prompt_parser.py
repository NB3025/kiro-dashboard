from prompt_parser import (
    extract_active_editor_file,
    extract_workspace_path,
)


def test_extract_active_editor_file_handles_nested_tag_format():
    # Real Kiro log format: outer <ACTIVE-EDITOR-FILE> with inner <file name="...">
    prompt = (
        "bizplan-review AIDC.md\n\n<EnvironmentContext>\n"
        "<ACTIVE-EDITOR-FILE>\n"
        '<file name="/Users/nambong/.kiro/steering/fswrite-plz.md" />\n'
        "</ACTIVE-EDITOR-FILE>\n"
        "</EnvironmentContext>"
    )
    assert (
        extract_active_editor_file(prompt)
        == "/Users/nambong/.kiro/steering/fswrite-plz.md"
    )


def test_extract_active_editor_file_still_supports_legacy_attr_format():
    # The TypeScript reference / synthetic fixture format uses an attribute.
    prompt = 'before\n<ACTIVE-EDITOR-FILE path="src/app.ts"\nafter'
    assert extract_active_editor_file(prompt) == "src/app.ts"


def test_extract_active_editor_file_returns_none_when_absent():
    assert extract_active_editor_file("just a plain prompt") is None
    assert extract_active_editor_file("") is None


def test_extract_workspace_path_nested_workspace_tag():
    prompt = (
        "<EnvironmentContext>\n"
        "<workspace>/home/me/proj</workspace>\n"
        "</EnvironmentContext>"
    )
    assert extract_workspace_path(prompt) == "/home/me/proj"


# ── active_spec_name: from active_file, strict — only when user is actually
# editing a spec document. Used as the 1st-tier session key.

def test_detect_spec_mode_returns_spec_name_when_active_file_is_spec():
    from prompt_parser import detect_spec_mode
    prompt = (
        "<ACTIVE-EDITOR-FILE>\n"
        '<file name=".kiro/specs/my-project/requirements.md" />\n'
        "</ACTIVE-EDITOR-FILE>"
    )
    out = detect_spec_mode(prompt)
    assert out["is_spec_mode"] is True
    assert out["active_spec_phase"] == "requirements"
    assert out["active_spec_name"] == "my-project"


def test_detect_spec_mode_returns_none_spec_name_when_no_active_spec_file():
    # Prompt mentions a .kiro/specs path but active_file is not a spec file.
    # active_spec_name must remain None (strict — we want to cluster by what
    # the user is *editing*, not what's merely referenced in text).
    from prompt_parser import detect_spec_mode
    prompt = (
        "Please review /Users/x/.kiro/specs/foo/requirements.md\n"
        "<ACTIVE-EDITOR-FILE>\n"
        '<file name="src/app.ts" />\n'
        "</ACTIVE-EDITOR-FILE>"
    )
    out = detect_spec_mode(prompt)
    assert out["active_spec_name"] is None


def test_detect_spec_mode_returns_none_when_no_spec_reference_at_all():
    from prompt_parser import detect_spec_mode
    out = detect_spec_mode("just a chat")
    assert out["is_spec_mode"] is False
    assert out["active_spec_phase"] == "not_spec"
    assert out["active_spec_name"] is None


def test_detect_spec_mode_handles_all_four_phases():
    from prompt_parser import detect_spec_mode
    for phase in ("requirements", "design", "tasks"):
        prompt = (
            "<ACTIVE-EDITOR-FILE>\n"
            f'<file name=".kiro/specs/abc/{phase}.md" />\n'
            "</ACTIVE-EDITOR-FILE>"
        )
        out = detect_spec_mode(prompt)
        assert out["active_spec_phase"] == phase
        assert out["active_spec_name"] == "abc"
