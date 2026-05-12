// PDF export (FR-EXPORT-PDF-1~7, SC12, NF6). The @react-pdf/renderer tree is
// assembled at the API layer; here we produce a pure spec (no JSX) so unit
// tests can verify shape/colors/failure markers without pulling react-pdf into
// the jest harness.

export const KIRO_BRAND_ACCENT = '#9046FF';
export const PDF_FONT_FAMILY = 'NotoSansCJK';
// Google Noto CJK (Regular). The SDK fetches and caches this on cold start.
// Bundle locally for air-gapped builds by pinning the Subsetted version to
// /public/fonts/NotoSansCJKkr-Regular.otf and point here.
export const NOTO_SANS_CJK_FONT_URL =
  'https://cdn.jsdelivr.net/gh/googlefonts/noto-cjk@main/Sans/OTF/Korean/NotoSansCJKkr-Regular.otf';

export interface PdfSectionSpec {
  key: string;
  body: string;
  isFailure: boolean;
  failureMessage?: string;
}

export interface PdfComponentSpec {
  title: string;
  subtitle: string;
  accentColor: string;
  sections: PdfSectionSpec[];
  footer: string;
}

export interface InsightsPdfOptions {
  userId: string;
  maskedDisplayName: string;
  bundle: { sections: Record<string, unknown> };
  facetVersion: string;
  modelId: string;
  startDate: string;
  endDate: string;
  sessionCount: number;
}

export function buildInsightsPdfComponentSpec(opts: InsightsPdfOptions): PdfComponentSpec {
  const sections: PdfSectionSpec[] = Object.entries(opts.bundle.sections).map(([key, value]) => {
    if (value === null || value === undefined) {
      return {
        key,
        body: '',
        isFailure: true,
        failureMessage: '⚠️ 이 섹션 생성에 실패했습니다',
      };
    }
    return {
      key,
      body: JSON.stringify(value, null, 2),
      isFailure: false,
    };
  });

  return {
    title: `Kiro Usage Insights — ${opts.maskedDisplayName} (${opts.startDate} ~ ${opts.endDate})`,
    subtitle: `분석 세션: ${opts.sessionCount}`,
    accentColor: KIRO_BRAND_ACCENT,
    sections,
    footer: `Generated with facet_version=${opts.facetVersion}, model=${opts.modelId}`,
  };
}
