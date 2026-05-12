'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useI18n } from '@/lib/i18n';
import { PER_USER_DRILLDOWN_TABS } from '@/lib/insights/ui-helpers';
import {
  normalizeSuggestions,
  featureBadge,
  type SteeringAddition,
  type FeatureToTry,
  type UsagePattern,
} from '@/lib/insights/suggestions-view';
import {
  normalizeProjectAreas,
  normalizeInteractionStyle,
  normalizeWhatWorks,
  normalizeFrictionAnalysis,
  normalizeFeatureAdoption,
  normalizeOnTheHorizon,
  normalizeFunEnding,
} from '@/lib/insights/section-views';
import { renderGlanceField } from '@/lib/insights/glance-render';

type Days = 7 | 30 | 90;

interface BundleSections {
  at_a_glance?: {
    // The schema asks for strings, but Opus occasionally returns objects or
    // arrays (triggers React #31). Typed as `unknown` so renderGlanceField
    // coerces safely at call sites.
    whats_working?: unknown;
    whats_hindering?: unknown;
    quick_wins?: unknown;
    ambitious_workflows?: unknown;
  } | null;
  [k: string]: unknown;
}

export function UserInsightsClient({ userId }: { userId: string }) {
  const { t } = useI18n();
  const [days, setDays] = useState<Days>(30);
  const [sections, setSections] = useState<BundleSections>({});
  const [activeTab, setActiveTab] = useState<string>('project_areas');
  const [maskedName, setMaskedName] = useState<string>(userId);

  useEffect(() => {
    // Connect to SSE endpoint — server emits {key,data} events per section.
    const es = new EventSource(`/api/insights/user/${userId}?days=${days}`);
    es.addEventListener('section', (e: MessageEvent) => {
      try {
        const payload = JSON.parse(e.data);
        setSections((prev) => ({ ...prev, [payload.key]: payload.data }));
      } catch {
        // tolerate partial payload
      }
    });
    es.addEventListener('done', () => es.close());
    es.addEventListener('error', () => es.close());
    return () => es.close();
  }, [userId, days]);

  useEffect(() => {
    // Masked display name is resolved by /api/idc-users on the server side
    // and injected into the drilldown via an auxiliary fetch.
    fetch(`/api/idc-users?userId=${encodeURIComponent(userId)}`)
      .then((r) => r.json())
      .then((res) => {
        if (res?.maskedDisplayName) setMaskedName(res.maskedDisplayName);
      })
      .catch(() => { /* keep userId fallback */ });
  }, [userId]);

  const glance = sections.at_a_glance ?? null;

  return (
    <div className="min-h-screen bg-black text-white p-6 space-y-6">
      <header className="space-y-3">
        <div className="flex items-center gap-3 text-sm">
          <Link href="/users" className="text-gray-400 hover:text-white whitespace-nowrap">
            ← {t('insights.drill.back')}
          </Link>
          <span className="text-gray-600 font-mono truncate">{maskedName}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            className="bg-gray-900 border border-gray-700 rounded px-2 py-1 text-sm"
            value={days}
            onChange={(e) => setDays(Number(e.target.value) as Days)}
          >
            <option value={7}>7d</option>
            <option value={30}>30d</option>
            <option value={90}>90d</option>
          </select>
          <div className="flex flex-wrap gap-2 ml-auto text-sm">
            <a
              href={`/api/insights/user/${userId}/export?format=markdown`}
              className="px-3 py-1 bg-gray-700 rounded hover:bg-gray-600 whitespace-nowrap"
            >
              {t('insights.drill.download_md')}
            </a>
            <a
              href={`/api/insights/user/${userId}/export?format=pdf`}
              className="px-3 py-1 bg-gray-700 rounded hover:bg-gray-600 whitespace-nowrap"
            >
              {t('insights.drill.download_pdf')}
            </a>
            <button
              onClick={() => navigator.clipboard?.writeText(window.location.href)}
              className="px-3 py-1 bg-gray-700 rounded hover:bg-gray-600 whitespace-nowrap"
            >
              {t('insights.drill.copy_link')}
            </button>
            <button
              onClick={async () => {
                await fetch(
                  `/api/insights/user/${userId}/regenerate?days=${days}`,
                  { method: 'POST' }
                );
                // Invalidate cache → reload the page so the SSE effect
                // below reconnects against a fresh Bedrock generation.
                window.location.reload();
              }}
              className="px-3 py-1 bg-[#9046FF] rounded hover:bg-[#7a3adf] whitespace-nowrap"
            >
              {t('insights.drill.regenerate')}
            </button>
          </div>
        </div>
      </header>

      {glance && (
        <section className="bg-gray-900/60 border border-[#9046FF]/50 rounded-lg p-5">
          <h2 className="text-lg font-bold mb-4">{t('insights.drill.at_a_glance')}</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <GlanceCard
              icon="✓"
              iconColor="text-[#9046FF]"
              borderColor="border-[#9046FF]/40"
              title={t('insights.glance.whats_working')}
              body={renderGlanceField(glance.whats_working)}
            />
            <GlanceCard
              icon="!"
              iconColor="text-yellow-400"
              borderColor="border-yellow-500/40"
              title={t('insights.glance.whats_hindering')}
              body={renderGlanceField(glance.whats_hindering)}
            />
            <GlanceCard
              icon="→"
              iconColor="text-green-400"
              borderColor="border-green-500/40"
              title={t('insights.glance.quick_wins')}
              body={renderGlanceField(glance.quick_wins)}
            />
            <GlanceCard
              icon="∞"
              iconColor="text-blue-400"
              borderColor="border-blue-500/40"
              title={t('insights.glance.ambitious_workflows')}
              body={renderGlanceField(glance.ambitious_workflows)}
            />
          </div>
        </section>
      )}

      <nav className="flex flex-wrap gap-2 border-b border-gray-800">
        {PER_USER_DRILLDOWN_TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-3 py-2 text-sm ${
              activeTab === tab.key
                ? 'border-b-2 border-[#9046FF] text-white'
                : 'text-gray-400'
            }`}
          >
            {t(tab.labelKey)}
          </button>
        ))}
      </nav>

      <section className="bg-gray-900/40 border border-gray-800 rounded p-4">
        {sections[activeTab] === undefined ? (
          <div className="flex items-center gap-3 text-gray-200 text-base py-6">
            <span className="inline-block w-4 h-4 rounded-full border-2 border-[#9046FF] border-t-transparent animate-spin" />
            <span>{t('insights.drill.skeleton')}</span>
          </div>
        ) : sections[activeTab] === null ? (
          <div className="text-yellow-400">⚠️ {t('insights.drill.section_failed')}</div>
        ) : activeTab === 'suggestions' ? (
          <SuggestionsView data={sections.suggestions} />
        ) : activeTab === 'project_areas' ? (
          <ProjectAreasView data={sections.project_areas} />
        ) : activeTab === 'interaction_style' ? (
          <InteractionStyleView data={sections.interaction_style} />
        ) : activeTab === 'what_works' ? (
          <WhatWorksView data={sections.what_works} />
        ) : activeTab === 'friction_analysis' ? (
          <FrictionAnalysisView data={sections.friction_analysis} />
        ) : activeTab === 'feature_adoption_audit' ? (
          <FeatureAdoptionView data={sections.feature_adoption_audit} />
        ) : activeTab === 'on_the_horizon' ? (
          <OnTheHorizonView data={sections.on_the_horizon} />
        ) : activeTab === 'fun_ending' ? (
          <FunEndingView data={sections.fun_ending} />
        ) : (
          <pre className="text-xs text-gray-300 whitespace-pre-wrap">
            {JSON.stringify(sections[activeTab], null, 2)}
          </pre>
        )}
      </section>
    </div>
  );
}

function GlanceCard({
  icon,
  iconColor,
  borderColor,
  title,
  body,
}: {
  icon: string;
  iconColor: string;
  borderColor: string;
  title: string;
  body: string;
}) {
  return (
    <div className={`bg-gray-950/40 border ${borderColor} rounded-lg p-4`}>
      <div className="flex items-center gap-2 mb-2">
        <span className={`${iconColor} text-lg font-bold`}>{icon}</span>
        <h3 className="text-sm font-semibold text-white uppercase tracking-wide">
          {title}
        </h3>
      </div>
      <p className="text-sm text-gray-300 whitespace-pre-wrap leading-relaxed">
        {body}
      </p>
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async () => {
        try {
          await navigator.clipboard?.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* ignore clipboard failures */
        }
      }}
      className="px-2 py-1 text-xs bg-gray-800 hover:bg-gray-700 rounded border border-gray-700"
    >
      {copied ? `✓ ${t('insights.sugg.copied')}` : `📋 ${t('insights.sugg.copy')}`}
    </button>
  );
}

function SuggestionsView({ data }: { data: unknown }) {
  const { t } = useI18n();
  const n = normalizeSuggestions(data);

  return (
    <div className="space-y-8">
      {/* Steering additions */}
      <div>
        <h3 className="text-base font-semibold text-white mb-3">
          {t('insights.sugg.steering_additions')}
        </h3>
        {n.steering_additions.length === 0 ? (
          <p className="text-sm text-gray-500">{t('insights.sugg.empty')}</p>
        ) : (
          <div className="space-y-3">
            {n.steering_additions.map((s, i) => (
              <SteeringAdditionCard key={i} item={s} />
            ))}
          </div>
        )}
      </div>

      {/* Features to try */}
      <div>
        <h3 className="text-base font-semibold text-white mb-3">
          {t('insights.sugg.features_to_try')}
        </h3>
        {n.features_to_try.length === 0 ? (
          <p className="text-sm text-gray-500">{t('insights.sugg.empty')}</p>
        ) : (
          <div className="space-y-3">
            {n.features_to_try.map((f, i) => (
              <FeatureToTryCard key={i} item={f} />
            ))}
          </div>
        )}
      </div>

      {/* Usage patterns */}
      <div>
        <h3 className="text-base font-semibold text-white mb-3">
          {t('insights.sugg.usage_patterns')}
        </h3>
        {n.usage_patterns.length === 0 ? (
          <p className="text-sm text-gray-500">{t('insights.sugg.empty')}</p>
        ) : (
          <div className="space-y-3">
            {n.usage_patterns.map((u, i) => (
              <UsagePatternCard key={i} item={u} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function SteeringAdditionCard({ item }: { item: SteeringAddition }) {
  const { t } = useI18n();
  return (
    <div className="border border-gray-800 rounded-lg p-4 bg-black/30">
      <div className="flex items-center gap-2 mb-2">
        <code className="text-sm text-[#9046FF] bg-gray-900/60 px-2 py-0.5 rounded">
          {item.target_filename || '.kiro/steering/?.md'}
        </code>
        <div className="ml-auto">
          <CopyButton text={item.addition} />
        </div>
      </div>
      <div className="text-xs uppercase tracking-wide text-gray-500 mt-3">
        {t('insights.sugg.steering_addition')}
      </div>
      <p className="text-sm text-gray-200 mt-1 whitespace-pre-wrap">{item.addition}</p>
      {item.why && (
        <>
          <div className="text-xs uppercase tracking-wide text-gray-500 mt-3">
            {t('insights.sugg.why')}
          </div>
          <p className="text-sm text-gray-400 mt-1">{item.why}</p>
        </>
      )}
      {item.prompt_scaffold && (
        <>
          <div className="text-xs uppercase tracking-wide text-gray-500 mt-3">
            {t('insights.sugg.prompt_scaffold')}
          </div>
          <p className="text-xs text-gray-500 mt-1">{item.prompt_scaffold}</p>
        </>
      )}
    </div>
  );
}

function FeatureToTryCard({ item }: { item: FeatureToTry }) {
  const { t } = useI18n();
  const badge = featureBadge(item.feature);
  return (
    <div className="border border-gray-800 rounded-lg p-4 bg-black/30">
      <div className="flex items-center gap-2 mb-2">
        <span
          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-xs ${badge.color}`}
        >
          <span>{badge.icon}</span>
          <span className="font-medium">{item.feature}</span>
        </span>
        {item.example_code && (
          <div className="ml-auto">
            <CopyButton text={item.example_code} />
          </div>
        )}
      </div>
      {item.one_liner && (
        <>
          <div className="text-xs uppercase tracking-wide text-gray-500 mt-3">
            {t('insights.sugg.one_liner')}
          </div>
          <p className="text-sm text-gray-200 mt-1">{item.one_liner}</p>
        </>
      )}
      {item.why_for_you && (
        <>
          <div className="text-xs uppercase tracking-wide text-gray-500 mt-3">
            {t('insights.sugg.why_for_you')}
          </div>
          <p className="text-sm text-gray-300 mt-1">{item.why_for_you}</p>
        </>
      )}
      {item.example_code && (
        <>
          <div className="text-xs uppercase tracking-wide text-gray-500 mt-3">
            {t('insights.sugg.example_code')}
          </div>
          <pre className="text-xs text-gray-300 bg-gray-900/80 border border-gray-800 rounded p-3 mt-1 overflow-x-auto whitespace-pre">
            {item.example_code}
          </pre>
        </>
      )}
    </div>
  );
}

function UsagePatternCard({ item }: { item: UsagePattern }) {
  const { t } = useI18n();
  return (
    <div className="border border-gray-800 rounded-lg p-4 bg-black/30">
      <div className="flex items-center gap-2">
        <h4 className="text-sm font-semibold text-white">{item.title}</h4>
        {item.copyable_prompt && (
          <div className="ml-auto">
            <CopyButton text={item.copyable_prompt} />
          </div>
        )}
      </div>
      {item.suggestion && (
        <p className="text-sm text-gray-200 mt-2">{item.suggestion}</p>
      )}
      {item.detail && (
        <p className="text-sm text-gray-400 mt-2 whitespace-pre-wrap">{item.detail}</p>
      )}
      {item.copyable_prompt && (
        <>
          <div className="text-xs uppercase tracking-wide text-gray-500 mt-3">
            {t('insights.sugg.copyable_prompt')}
          </div>
          <pre className="text-xs text-gray-300 bg-gray-900/80 border border-gray-800 rounded p-3 mt-1 overflow-x-auto whitespace-pre-wrap">
            {item.copyable_prompt}
          </pre>
        </>
      )}
    </div>
  );
}

function EmptyNote() {
  const { t } = useI18n();
  return <p className="text-sm text-gray-500">{t('insights.view.empty')}</p>;
}

function ProjectAreasView({ data }: { data: unknown }) {
  const { t } = useI18n();
  const areas = normalizeProjectAreas(data);
  if (areas.length === 0) return <EmptyNote />;
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {areas.map((a, i) => (
        <div key={i} className="border border-gray-800 rounded-lg p-4 bg-black/30">
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-semibold text-white">{a.name}</h4>
            <span className="ml-auto text-xs text-[#9046FF] bg-[#9046FF]/10 border border-[#9046FF]/40 rounded px-2 py-0.5">
              {a.session_count} {t('insights.view.sessions')}
            </span>
          </div>
          {a.description && (
            <p className="text-sm text-gray-300 mt-2 whitespace-pre-wrap">{a.description}</p>
          )}
        </div>
      ))}
    </div>
  );
}

function InteractionStyleView({ data }: { data: unknown }) {
  const { t } = useI18n();
  const n = normalizeInteractionStyle(data);
  return (
    <div className="space-y-4">
      {n.summary && (
        <div>
          <div className="text-xs uppercase tracking-wide text-gray-500 mb-1">
            {t('insights.view.summary')}
          </div>
          <p className="text-sm text-gray-200 whitespace-pre-wrap">{n.summary}</p>
        </div>
      )}
      {n.traits.length > 0 && (
        <div>
          <div className="text-xs uppercase tracking-wide text-gray-500 mb-2">
            {t('insights.view.traits')}
          </div>
          <ul className="space-y-2">
            {n.traits.map((tr, i) => (
              <li key={i} className="border border-gray-800 rounded p-3 bg-black/30">
                <div className="text-sm font-medium text-[#9046FF]">{tr.label}</div>
                {tr.evidence && (
                  <p className="text-sm text-gray-300 mt-1 whitespace-pre-wrap">{tr.evidence}</p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {!n.summary && n.traits.length === 0 && <EmptyNote />}
    </div>
  );
}

function WhatWorksView({ data }: { data: unknown }) {
  const { t } = useI18n();
  const n = normalizeWhatWorks(data);
  return (
    <div className="space-y-4">
      {n.summary && (
        <div className="bg-green-950/30 border border-green-800/60 rounded p-3">
          <p className="text-sm text-gray-200 whitespace-pre-wrap">{n.summary}</p>
        </div>
      )}
      {n.items.length > 0 ? (
        <ul className="space-y-2">
          {n.items.map((it, i) => (
            <li key={i} className="border border-gray-800 rounded p-3 bg-black/30">
              <div className="flex items-start gap-2">
                <span className="text-green-400 mt-0.5">✓</span>
                <div className="flex-1">
                  <div className="text-sm font-medium text-white">{it.title}</div>
                  {it.evidence && (
                    <p className="text-sm text-gray-400 mt-1 whitespace-pre-wrap">{it.evidence}</p>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        !n.summary && <EmptyNote />
      )}
      {/* If summary exists but no items, render nothing below — summary alone is fine */}
      {n.items.length === 0 && n.summary && null}
      {n.items.length > 0 && <div className="text-xs text-gray-500">{t('insights.view.items')}</div>}
    </div>
  );
}

function FrictionAnalysisView({ data }: { data: unknown }) {
  const { t } = useI18n();
  const n = normalizeFrictionAnalysis(data);
  return (
    <div className="space-y-4">
      {n.intro && (
        <div className="bg-yellow-950/30 border border-yellow-800/60 rounded p-3">
          <p className="text-sm text-gray-200 whitespace-pre-wrap">{n.intro}</p>
        </div>
      )}
      {n.categories.length > 0 ? (
        <div className="space-y-3">
          {n.categories.map((c, i) => (
            <div key={i} className="border border-gray-800 rounded p-3 bg-black/30">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-yellow-400">!</span>
                <code className="text-sm text-yellow-300 bg-yellow-950/30 px-2 py-0.5 rounded">
                  {c.name}
                </code>
              </div>
              {c.examples.length > 0 && (
                <>
                  <div className="text-xs uppercase tracking-wide text-gray-500 mb-1">
                    {t('insights.view.examples')}
                  </div>
                  <ul className="list-disc list-inside space-y-1 text-sm text-gray-300">
                    {c.examples.map((ex, j) => (
                      <li key={j} className="whitespace-pre-wrap">{ex}</li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          ))}
        </div>
      ) : (
        !n.intro && <EmptyNote />
      )}
    </div>
  );
}

function FeatureAdoptionView({ data }: { data: unknown }) {
  const { t } = useI18n();
  const n = normalizeFeatureAdoption(data);
  const rows: Array<{ key: string; label: string; value: string }> = [
    { key: 'spec_usage', label: t('insights.adoption.spec_usage'), value: n.spec_usage },
    { key: 'steering_usage', label: t('insights.adoption.steering_usage'), value: n.steering_usage },
    { key: 'skill_usage', label: t('insights.adoption.skill_usage'), value: n.skill_usage },
    { key: 'hook_usage', label: t('insights.adoption.hook_usage'), value: n.hook_usage },
    { key: 'subagent_usage', label: t('insights.adoption.subagent_usage'), value: n.subagent_usage },
    { key: 'power_usage', label: t('insights.adoption.power_usage'), value: n.power_usage },
  ];
  const populated = rows.filter((r) => r.value.length > 0);
  if (populated.length === 0) return <EmptyNote />;
  return (
    <div className="space-y-3">
      {populated.map((r) => (
        <div key={r.key} className="border border-gray-800 rounded-lg p-4 bg-black/30">
          <div className="text-sm font-semibold text-[#9046FF] mb-2">{r.label}</div>
          <p className="text-sm text-gray-200 whitespace-pre-wrap">{r.value}</p>
        </div>
      ))}
    </div>
  );
}

function OnTheHorizonView({ data }: { data: unknown }) {
  const { t } = useI18n();
  const proposals = normalizeOnTheHorizon(data);
  if (proposals.length === 0) return <EmptyNote />;
  return (
    <div className="space-y-3">
      {proposals.map((p, i) => (
        <div
          key={i}
          className="border border-blue-900/60 rounded-lg p-4 bg-blue-950/20"
        >
          <div className="flex items-start gap-2">
            <span className="text-blue-400 mt-0.5">∞</span>
            <div className="flex-1">
              <h4 className="text-sm font-semibold text-white">{p.title}</h4>
              {p.why && (
                <>
                  <div className="text-xs uppercase tracking-wide text-gray-500 mt-2">
                    {t('insights.view.why')}
                  </div>
                  <p className="text-sm text-gray-300 mt-1 whitespace-pre-wrap">{p.why}</p>
                </>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function FunEndingView({ data }: { data: unknown }) {
  const { headline, detail } = normalizeFunEnding(data);
  if (!headline && !detail) return <EmptyNote />;
  return (
    <div className="bg-gradient-to-r from-[#9046FF]/10 to-transparent border border-[#9046FF]/40 rounded-lg p-6">
      <div className="flex items-start gap-3">
        <span className="text-2xl">🎉</span>
        <div className="flex-1">
          {headline && (
            <p className="text-base text-white font-medium whitespace-pre-wrap">{headline}</p>
          )}
          {detail && (
            <p className="text-sm text-gray-400 mt-2 whitespace-pre-wrap">{detail}</p>
          )}
        </div>
      </div>
    </div>
  );
}

