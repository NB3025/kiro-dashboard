// Orchestrator — fan out per-section Bedrock calls, parse results, honor
// at_a_glance quality gate. Bedrock I/O is injected via `BedrockInvoker` so
// unit tests stay deterministic without hitting AWS.
//
// Design §8 / FR-INS-1~9.

import { createHash } from 'crypto';

import { PER_USER_CORE_SECTIONS, SECTION_PROMPTS } from './section-prompts';
import type { SectionKey, PerUserCoreSection } from './section-prompts';
import { extractJson } from './json-extractor';
import { shouldGenerateAtAGlance } from './section-validator';

export function computeUid8(userId: string): string {
  return createHash('sha256').update(userId, 'utf8').digest('hex').slice(0, 8);
}

export const BEDROCK_REGION = 'ap-northeast-2';

// Cross-region inference profiles use a `global.` / `us.` / `apac.` etc. prefix
// before the vendor namespace (e.g., `global.anthropic.claude-opus-4-7`).
const MODEL_ID_RE = /^([a-z]+\.)?(anthropic\.|amazon\.)[a-z0-9-]+(:\d+)?(\[[^\]]+\])?$/;

export function validateModelId(modelId: string): boolean {
  if (!modelId || typeof modelId !== 'string') return false;
  return MODEL_ID_RE.test(modelId);
}

export interface BedrockInvokerHandle extends Function {
  (args: BedrockInvokerArgs): Promise<string>;
  region: string;
  modelId: string;
}

export interface CreateBedrockInvokerOptions {
  modelId: string;
  region?: string;
}

/**
 * Build a real Bedrock Converse invoker.
 *
 * Pattern mirrors the aws-samples `ConverseCommand with Anthropic Claude`
 * sample (AWS SDK for JavaScript v3). Lazy-loaded so that unit tests can
 * mock `@aws-sdk/client-bedrock-runtime` without pulling the SDK in.
 *
 * Reference: https://docs.aws.amazon.com/bedrock/latest/userguide/service_code_examples_bedrock-runtime_Converse_AnthropicClaude_section.html
 */
export function createBedrockInvoker(
  opts: CreateBedrockInvokerOptions
): BedrockInvokerHandle {
  const region = opts.region ?? BEDROCK_REGION;
  const modelId = opts.modelId;
  if (!validateModelId(modelId)) {
    throw new Error(`createBedrockInvoker: invalid modelId "${modelId}" (SC9)`);
  }

  // Lazy ESM import so jest unit tests that never instantiate a real client
  // don't need the heavy SDK in the module graph.
  const clientPromise = import('@aws-sdk/client-bedrock-runtime').then(
    ({ BedrockRuntimeClient }) => new BedrockRuntimeClient({ region })
  );

  const fn = (async (args: BedrockInvokerArgs): Promise<string> => {
    const { ConverseCommand } = await import('@aws-sdk/client-bedrock-runtime');
    const client = await clientPromise;

    // Prompt layout mirrors the CC reference: section-specific instructions
    // followed by a DATA block. CC original interleaves JSON stats with
    // literal bullet-list narrative sections (SESSION SUMMARIES / FRICTION
    // DETAILS / USER INSTRUCTIONS). We mirror that here: the narrative
    // fields live on dataContext as pre-rendered strings, and we split them
    // out so the LLM sees them as human-readable blocks instead of
    // JSON-escaped multi-line strings.
    const ctx = args.dataContext as
      | (Record<string, unknown> & {
          session_summaries?: string;
          friction_details?: string;
          user_instructions?: string;
        })
      | undefined;
    const sessionSummaries = ctx?.session_summaries ?? '(no sessions analyzed)';
    const frictionDetails = ctx?.friction_details ?? '(no friction captured)';
    const userInstructions = ctx?.user_instructions ?? 'None captured';

    // Strip the three narrative fields from the JSON stats block so we don't
    // duplicate them. Keep everything else (model_mix, spec_phases, ...).
    const stats: Record<string, unknown> = { ...(ctx || {}) };
    delete stats.session_summaries;
    delete stats.friction_details;
    delete stats.user_instructions;

    let userMessage =
      `${args.prompt}\n\nDATA:\n` +
      JSON.stringify({ userId: args.userId, dataContext: stats }, null, 2) +
      `\n\nSESSION SUMMARIES:\n${sessionSummaries}\n\n` +
      `FRICTION DETAILS:\n${frictionDetails}\n\n` +
      `USER INSTRUCTIONS TO KIRO:\n${userInstructions}`;

    // CC §6 fidelity: at_a_glance is a synthesis over the already-produced
    // core section results, not a parallel 9th section re-reading Facets.
    // Append the core sections block so the model draws from siblings'
    // judgments instead of re-interpreting the raw narrative.
    if (args.section === 'at_a_glance' && args.coreResults) {
      userMessage +=
        `\n\nCORE SECTIONS (already generated — synthesize from these, do not re-interpret raw Facets):\n` +
        JSON.stringify(args.coreResults, null, 2);
    }

    // at_a_glance synthesizes over much more input (8 core section JSONs),
    // so give it headroom. Core sections keep the original 4K budget.
    const maxTokens = args.section === 'at_a_glance' ? 8192 : 4096;

    const command = new ConverseCommand({
      modelId,
      messages: [
        {
          role: 'user',
          content: [{ text: userMessage }],
        },
      ],
      // Claude Opus 4.7 deprecated temperature/topP at the model level —
      // passing them causes a ValidationException. Keep maxTokens only.
      inferenceConfig: { maxTokens },
    });

    const response = await client.send(command);
    const text = response.output?.message?.content?.[0]?.text;
    if (typeof text !== 'string') {
      throw new Error(`Bedrock returned no text for section "${args.section}"`);
    }
    return text;
  }) as unknown as BedrockInvokerHandle;

  fn.region = region;
  fn.modelId = modelId;
  return fn;
}

export interface BedrockInvokerArgs {
  section: SectionKey;
  prompt: string;
  dataContext: unknown;
  facets: unknown[];
  userId?: string;
  // Populated only when section === 'at_a_glance'. Each core section's
  // parsed JSON (or null if that section failed/was malformed). CC §6
  // fidelity: at_a_glance synthesizes over the just-produced core results
  // rather than re-reading the same Facet narrative.
  coreResults?: Record<string, unknown | null>;
}

export type BedrockInvoker = (args: BedrockInvokerArgs) => Promise<string>;

export interface PerUserInsightsBundle {
  userId: string;
  sections: Record<PerUserCoreSection | 'at_a_glance', unknown | null>;
}

async function runSection(
  section: SectionKey,
  invoker: BedrockInvoker,
  args: Omit<BedrockInvokerArgs, 'section' | 'prompt'>
): Promise<unknown | null> {
  try {
    const text = await invoker({ ...args, section, prompt: SECTION_PROMPTS[section] });
    return extractJson(text);
  } catch {
    return null;
  }
}

export interface GeneratePerUserInsightsOptions {
  userId: string;
  dataContext: unknown;
  facets: unknown[];
  invoker: BedrockInvoker;
}

export async function generatePerUserInsights(
  opts: GeneratePerUserInsightsOptions
): Promise<PerUserInsightsBundle> {
  const base = { dataContext: opts.dataContext, facets: opts.facets, userId: opts.userId };

  const coreResults = await Promise.all(
    PER_USER_CORE_SECTIONS.map((section) => runSection(section, opts.invoker, base))
  );

  const sections = {} as Record<PerUserCoreSection | 'at_a_glance', unknown | null>;
  const coreResultsByName: Record<string, unknown | null> = {};
  PER_USER_CORE_SECTIONS.forEach((key, idx) => {
    sections[key] = coreResults[idx];
    coreResultsByName[key] = coreResults[idx];
  });

  if (shouldGenerateAtAGlance(coreResults)) {
    sections.at_a_glance = await runSection('at_a_glance', opts.invoker, {
      ...base,
      coreResults: coreResultsByName,
    });
  } else {
    sections.at_a_glance = null;
  }

  return { userId: opts.userId, sections };
}

