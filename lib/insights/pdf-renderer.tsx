// Server-side @react-pdf/renderer wrapper. Imported dynamically by the
// export route so client bundles and jest unit tests don't pull in
// the renderer.
//
// FR-EXPORT-PDF-1~7 / NF6.

import * as React from 'react';
import {
  Document,
  Font,
  Page,
  StyleSheet,
  Text,
  View,
  renderToBuffer,
} from '@react-pdf/renderer';
import {
  buildInsightsPdfComponentSpec,
  NOTO_SANS_CJK_FONT_URL,
  PDF_FONT_FAMILY,
  type InsightsPdfOptions,
} from './pdf-export';

let fontRegistered = false;
function registerFontOnce(): void {
  if (fontRegistered) return;
  Font.register({
    family: PDF_FONT_FAMILY,
    src: NOTO_SANS_CJK_FONT_URL,
  });
  fontRegistered = true;
}

const styles = StyleSheet.create({
  page: {
    padding: 40,
    fontFamily: PDF_FONT_FAMILY,
    fontSize: 10,
    color: '#1a1a1a',
  },
  title: {
    fontSize: 18,
    color: '#9046FF',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 10,
    color: '#555',
    marginBottom: 20,
  },
  sectionHeading: {
    fontSize: 13,
    color: '#9046FF',
    marginTop: 14,
    marginBottom: 4,
    borderBottom: '1 solid #9046FF',
    paddingBottom: 2,
  },
  sectionBody: {
    fontSize: 9,
    color: '#222',
    lineHeight: 1.4,
  },
  failure: {
    fontSize: 9,
    color: '#b07d00',
    fontStyle: 'italic',
  },
  footer: {
    position: 'absolute',
    fontSize: 8,
    bottom: 20,
    left: 40,
    right: 40,
    color: '#888',
    textAlign: 'center',
  },
});

function InsightsPdfDocument({ opts }: { opts: InsightsPdfOptions }) {
  const spec = buildInsightsPdfComponentSpec(opts);
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.title}>{spec.title}</Text>
        <Text style={styles.subtitle}>{spec.subtitle}</Text>

        {spec.sections.map((s) => (
          <View key={s.key} wrap={false}>
            <Text style={styles.sectionHeading}>{s.key}</Text>
            {s.isFailure ? (
              <Text style={styles.failure}>{s.failureMessage}</Text>
            ) : (
              <Text style={styles.sectionBody}>{s.body}</Text>
            )}
          </View>
        ))}

        <Text style={styles.footer} fixed>
          {spec.footer}
        </Text>
      </Page>
    </Document>
  );
}

export async function renderInsightsPdfBuffer(opts: InsightsPdfOptions): Promise<Buffer> {
  registerFontOnce();
  return renderToBuffer(<InsightsPdfDocument opts={opts} />);
}
