// Verbatim Bedrock prompts for each insights section (design §6.1~6.12).
// Contract: every prompt must end with a "RESPOND WITH ONLY A VALID JSON OBJECT"
// block so the extractor can parse a single object reliably.

export const PER_USER_CORE_SECTIONS = [
  'project_areas',
  'interaction_style',
  'what_works',
  'friction_analysis',
  'suggestions',
  'feature_adoption_audit',
  'on_the_horizon',
  'fun_ending',
] as const;

export type PerUserCoreSection = (typeof PER_USER_CORE_SECTIONS)[number];
export type SectionKey = PerUserCoreSection | 'at_a_glance';

const JSON_TAIL = `

EVIDENCE PRIORITY: When generating narrative, prefer qualitative evidence
from the SESSION SUMMARIES / FRICTION DETAILS / USER INSTRUCTIONS blocks
over the raw numeric counters in dataContext. The numbers show scale; the
narrative blocks show what actually happened. Cite specific session
summaries or instructions when justifying a recommendation — do not
fabricate evidence not present in the DATA block.

LANGUAGE: Write every narrative value (descriptions, summaries, rationales, evidence, narrative fields, titles, names, examples) in Korean (한국어).
JSON keys and enum values remain in English unchanged (e.g. "steering", "hook", "subagent", "power", "steering_library", "onboarding", "routing_policy").

RESPOND WITH ONLY A VALID JSON OBJECT matching the schema above.`;

export const SECTION_PROMPTS: Record<SectionKey, string> = {
  project_areas: `Analyze this Kiro usage data and identify project areas.
{"areas":[{"name":"Area","session_count":N,"description":"2-3 sentences"}]}${JSON_TAIL}`,

  interaction_style: `Describe the user's interaction style with Kiro in second person.
{"summary":"1 paragraph","traits":[{"label":"...","evidence":"..."}]}${JSON_TAIL}`,

  what_works: `Identify what is working well for this user.
{"summary":"1 sentence","items":[{"title":"...","evidence":"..."}]}${JSON_TAIL}`,

  friction_analysis: `Analyze this Kiro usage data and identify friction points for this user.
Use second person ("you"). Include 3 friction categories with 2 examples each.
{"intro":"1 sentence","categories":[{"name":"...","examples":["..."]}]}${JSON_TAIL}`,

  suggestions: `Analyze this Kiro usage data and suggest improvements.

## KIRO FEATURES REFERENCE (pick from these for features_to_try):
1. **MCP Servers**: Connect Kiro to external tools, databases, and APIs via Model Context Protocol.
   - How to use: \`kiro-cli mcp add --name <name> --scope global --command <cmd> --args <arg>\`
     (config at ~/.kiro/settings/mcp.json or .kiro/settings/mcp.json)
   - Good for: database queries, Slack integration, GitHub issue lookup, internal APIs
2. **Custom Skills**: Reusable prompts you define as markdown files that run with a single /command.
   - How to use: Create \`.kiro/skills/<name>/SKILL.md\` with instructions. Then type \`/<name>\` to run it.
   - Good for: repetitive workflows — /commit, /review, /test, /deploy, /pr, or complex multi-step workflows
3. **Hooks**: Shell commands or agent actions that auto-run at specific lifecycle events.
   - How to use: Author a hook file at \`.kiro/hooks/<name>.kiro.hook\` bound to one event.
   - Available events: PromptSubmit, AgentStop, PreToolUse, PostToolUse, FileCreate, FileSave, FileDelete, PreTaskExecution, PostTaskExecution, ManualTrigger
   - Good for: auto-formatting, running type checks, enforcing conventions, spec-task gating
4. **Headless Mode**: Run Kiro non-interactively from scripts and CI/CD.
   - How to use: \`kiro-cli chat --no-interactive --trust-tools=<categories> "<prompt>"\`
   - Good for: CI/CD integration, batch code fixes, automated reviews
5. **Subagent / Task Agents**: Kiro spawns focused sub-agents for complex exploration or parallel work.
   - How to use: Author at \`~/.kiro/agents/<name>.md\`. Kiro auto-invokes when helpful, or ask "use an agent to explore X".
   - Good for: codebase exploration, understanding complex systems
6. **Power**: On-demand MCP + steering + hook bundles that activate together.
   - How to use: Create a \`power-<name>/POWER.md\` bundle and share it.
   - Good for: domain workflows that need rules, automation, and external tool access in one package.

POWERS HIERARCHY RULE (MANDATORY):
If steering + hook would cover the same external service/domain (e.g., a Stripe
webhook hook + Stripe steering rules), emit ONE Power candidate instead of
separate steering + hook items.

RESPOND WITH ONLY A VALID JSON OBJECT:
{
  "steering_additions": [
    {"addition": "A specific rule or block to add to a .kiro/steering/<name>.md file based on workflow patterns (e.g., 'Always run tests after modifying auth-related files')", "why": "1 sentence explaining why this would help based on actual sessions", "target_filename": ".kiro/steering/<name>.md", "prompt_scaffold": "Instructions for where to place this inside the file (e.g., 'Add under ## Testing section')"}
  ],
  "features_to_try": [
    {"feature": "Feature name from KIRO FEATURES REFERENCE above", "one_liner": "What it does", "why_for_you": "Why this would help YOU based on your sessions", "example_code": "Actual command, config, or file snippet to copy"}
  ],
  "usage_patterns": [
    {"title": "Short title", "suggestion": "1-2 sentence summary", "detail": "3-4 sentences explaining how this applies to YOUR work", "copyable_prompt": "A specific prompt to copy and try"}
  ]
}

IMPORTANT for steering_additions: PRIORITIZE instructions that appear MULTIPLE TIMES
in the user's sessions. If the user told Kiro the same thing in 2+ sessions
(e.g., "always run tests", "use TypeScript"), that is a PRIME candidate — they
should not have to repeat themselves. Each addition targets a separate
\`.kiro/steering/<name>.md\` file so rules stay small and composable.

IMPORTANT for features_to_try: Pick 2-3 entries from the KIRO FEATURES REFERENCE
above. Include 2-3 items for each category (steering_additions / features_to_try
/ usage_patterns).${JSON_TAIL}`,

  feature_adoption_audit: `Report Kiro feature adoption signals.
Assess adoption of each extensibility surface: spec workflow usage, steering
rules (.kiro/steering/*.md), Custom Skills (.kiro/skills/<name>/SKILL.md,
invokable via /<name>), hooks (.kiro/hooks/*.kiro.hook), subagents
(~/.kiro/agents/*.md), and Power bundles (power-<name>/POWER.md).

{"spec_usage":"...","steering_usage":"...","skill_usage":"...","hook_usage":"...","subagent_usage":"...","power_usage":"..."}${JSON_TAIL}`,

  on_the_horizon: `What ambitious workflow should this user try next?
{"proposals":[{"title":"...","why":"..."}]}${JSON_TAIL}`,

  // Ported from CC insights.ts:1484-1492 (§4.7). The model must surface a
  // memorable QUALITATIVE moment from the transcripts — NOT a statistic.
  // Something human, funny, or surprising. Look in SESSION SUMMARIES.
  fun_ending: `Analyze this Kiro usage data and find a memorable moment.

Find something genuinely interesting or amusing from the session summaries —
a human, funny, or surprising moment. DO NOT return a statistic or a
generic encouragement. Draw the moment from SESSION SUMMARIES / FRICTION
DETAILS / USER INSTRUCTIONS in the DATA block below.

{"headline":"A memorable QUALITATIVE moment from the transcripts - not a statistic. Something human, funny, or surprising.","detail":"Brief context about when/where this happened"}${JSON_TAIL}`,

  at_a_glance: `Synthesize the per-user insights into a 4-part summary:
What's Working / What's Hindering / Quick Wins / Ambitious Workflows.

STRICT TYPE REQUIREMENT: Every value below MUST be a PLAIN STRING (not an
object, not an array). If you want to express multiple points, join them
into a single string using newline characters. Do NOT emit arrays of
objects like [{"type":"steering","title":"...","rationale":"..."}]. The
renderer cannot handle non-string values and will crash the UI.

{"whats_working":"single string","whats_hindering":"single string","quick_wins":"single string","ambitious_workflows":"single string"}${JSON_TAIL}`,
};
