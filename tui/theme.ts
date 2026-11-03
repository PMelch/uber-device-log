export const tuiThemeModes = ['auto', 'light', 'dark', 'mono'] as const;
export type TuiThemeMode = typeof tuiThemeModes[number];
export interface TerminalThemeColors { defaultBackground?: string | null; defaultForeground?: string | null; palette?: (string | null)[] }
const valid = (color: unknown): color is string => typeof color === 'string' && /^#[\da-f]{6}$/i.test(color);
const rgb = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
function mix(a: string, b: string, amount: number) {
  const other = rgb(b);
  return '#' + rgb(a).map((v, i) => Math.round(v + (other[i]! - v) * amount).toString(16).padStart(2, '0')).join('');
}
function luminance(hex: string) {
  return rgb(hex).map(v => { const s = v / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; })
    .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i]!, 0);
}
export function contrastRatio(a: string, b: string) {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light! + 0.05) / (dark! + 0.05);
}
export function createTuiTheme(mode: TuiThemeMode, terminal?: TerminalThemeColors | null) {
  const automatic = mode === 'auto' && valid(terminal?.defaultBackground);
  const background = automatic ? terminal!.defaultBackground! : mode === 'light' ? '#ffffff' : mode === 'mono' ? '#000000' : '#101923';
  const foreground = contrastRatio('#000000', background) > contrastRatio('#ffffff', background) ? '#000000' : '#ffffff';
  const opposite = foreground === '#000000' ? '#ffffff' : '#000000';
  const surfaceDirection = contrastRatio(foreground, background) >= 7 ? foreground : opposite;
  const panel = mix(background, surfaceDirection, 0.035);
  const selected = mix(background, surfaceDirection, 0.16);
  const surfaces = [background, panel, selected];
  const readable = (color: string) => {
    for (let step = 0; step <= 100; step++) {
      const candidate = mix(color, foreground, step / 100);
      if (surfaces.every(bg => contrastRatio(candidate, bg) >= 4.5)) return candidate;
    }
    return foreground;
  };
  const ansi = (index: number, fallback: string) => automatic && valid(terminal?.palette?.[index]) ? terminal!.palette![index]! : fallback;
  const text = mode === 'mono' ? '#ffffff' : readable(automatic && valid(terminal?.defaultForeground) ? terminal!.defaultForeground! : foreground === '#ffffff' ? '#d8e6ef' : '#202830');
  const role = (color: string) => mode === 'mono' ? text : readable(color);
  return { background, panel, selected, text, muted: role('#8493a0'), border: role('#667788'),
    accent: role(ansi(6, '#269b91')), source: role(ansi(4, '#5d8ee8')),
    error: role(ansi(1, '#e34c4c')), warn: role(ansi(3, '#c58b20')) };
}
