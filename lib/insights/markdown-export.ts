// Markdown export (FR-EXPORT-MD-1~5, SC11). Filename uses uid8 + masked-safe
// display name so the shared artifact never leaks the original userId, email,
// or unmasked displayName.

import { computeUid8 } from './section-generator';

export interface InsightsFilenameOptions {
  userId: string;
  maskedDisplayName: string;
  date: string;
  extension: 'md' | 'pdf';
}

export function buildInsightsFilename(opts: InsightsFilenameOptions): string {
  if (!opts.userId) {
    throw new Error('buildInsightsFilename: userId must not be empty (SC11)');
  }
  const uid8 = computeUid8(opts.userId);
  const maskedSafe = opts.maskedDisplayName.replace(/\*/g, '_');
  return `${uid8}-${maskedSafe}-insights-${opts.date}.${opts.extension}`;
}

export interface InsightsMarkdownOptions {
  userId: string;
  maskedDisplayName: string;
  bundle: { sections: Record<string, unknown> };
  facetVersion: string;
  modelId: string;
  startDate: string;
  endDate: string;
  sessionCount: number;
}

export function buildInsightsMarkdown(opts: InsightsMarkdownOptions): string {
  const lines: string[] = [];
  lines.push(
    `# Kiro Usage Insights — ${opts.maskedDisplayName} (${opts.startDate} ~ ${opts.endDate})`
  );
  lines.push(
    `분석 세션: ${opts.sessionCount} | 생성 시각: ${new Date().toISOString()}`
  );
  lines.push('');

  for (const [key, section] of Object.entries(opts.bundle.sections)) {
    lines.push(`## ${key}`);
    if (section === null || section === undefined) {
      lines.push('⚠️ 이 섹션 생성에 실패했습니다');
    } else {
      lines.push('```json');
      lines.push(JSON.stringify(section, null, 2));
      lines.push('```');
    }
    lines.push('');
  }

  lines.push('---');
  lines.push(`Generated with facet_version=${opts.facetVersion}, model=${opts.modelId}`);
  return lines.join('\n');
}
