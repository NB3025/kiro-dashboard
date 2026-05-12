/** @jest-environment node */
// Lightweight guard tests for the insights At a Glance card labels.
// At a Glance renders 4 cards (whats_working / whats_hindering / quick_wins /
// ambitious_workflows). Previously only icons were shown — users couldn't
// tell which card was which. Require a dedicated i18n label per card.

// i18n.tsx is a client component ("use client") and hard to import cleanly
// in a node test; we read the source and assert the keys exist in both
// locales. That's the minimum signal we care about.

import { readFileSync } from 'fs';
import { join } from 'path';

const SRC = readFileSync(join(__dirname, '..', '..', 'lib', 'i18n.tsx'), 'utf-8');

describe('insights glance card labels', () => {
  const keys = [
    'insights.glance.whats_working',
    'insights.glance.whats_hindering',
    'insights.glance.quick_wins',
    'insights.glance.ambitious_workflows',
  ];

  for (const key of keys) {
    it(`defines ${key} at least twice (ko + en)`, () => {
      const occurrences = SRC.split(`'${key}'`).length - 1;
      expect(occurrences).toBeGreaterThanOrEqual(2);
    });
  }
});
