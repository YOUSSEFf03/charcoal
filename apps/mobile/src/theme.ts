import { Platform } from 'react-native';

/** Palette lifted from the "freight ledger" design mock applied to the main screen. */
export const colors = {
  ink: '#0F2536',
  inkSoft: '#4A6070',
  bg: '#EEF1F0',
  card: '#FFFFFF',
  line: '#DCE4E2',
  teal: '#0E7C86',
  tealDeep: '#0A5960',
  amber: '#C97A1A',
  amberBg: '#FBF0DF',
  danger: '#B91C1C',
} as const;

/** No IBM Plex Mono in the bundle — closest built-in monospace per platform. */
export const monoFont = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' });
