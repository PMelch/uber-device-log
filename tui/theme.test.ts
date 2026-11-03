import { test, expect } from 'bun:test';
import { createTuiTheme, contrastRatio } from './theme';

test('all text roles meet 4.5 contrast on normal, panel and selected backgrounds', () => {
  for (const background of ['#000000', '#ffffff', '#808080', '#f4e8d0', '#142233']) {
    const theme = createTuiTheme('auto', { defaultBackground: background, defaultForeground: background, palette: Array(16).fill(background) });
    expect(theme.background).toBe(background);
    for (const surface of [theme.background, theme.panel, theme.selected]) {
      for (const role of [theme.text, theme.muted, theme.accent, theme.source, theme.error, theme.warn]) {
        expect(contrastRatio(role, surface)).toBeGreaterThanOrEqual(4.5);
      }
    }
  }
});
test('explicit themes override terminal colors and monochrome has no colored roles', () => {
  expect(createTuiTheme('light', { defaultBackground: '#000000' }).background).toBe('#ffffff');
  expect(createTuiTheme('dark', { defaultBackground: '#ffffff' }).background).toBe('#101923');
  const mono = createTuiTheme('mono');
  expect(mono.error).toBe(mono.text); expect(mono.warn).toBe(mono.text); expect(mono.source).toBe(mono.text);
  expect(createTuiTheme('auto', { defaultBackground: 'invalid' })).toEqual(createTuiTheme('dark'));
});
test('selection stays visible on black and white terminals and mono is grayscale', () => {
  for (const mode of ['light', 'dark', 'mono', 'auto'] as const) {
    for (const background of ['#000000', '#ffffff']) {
      const theme = createTuiTheme(mode, { defaultBackground: background });
      expect(theme.selected).not.toBe(theme.background);
      if (mode === 'mono') for (const color of Object.values(theme)) {
        expect(color.slice(1, 3)).toBe(color.slice(3, 5));
        expect(color.slice(3, 5)).toBe(color.slice(5, 7));
      }
    }
  }
});
