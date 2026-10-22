/** Previews are bounded; opaque handles allow on-demand inspection without invoking accessors. */
export interface ConsoleValue {
  handle?: string;
  type: string;
  text: string;
  children?: { name: string; value: ConsoleValue }[];
  truncated?: boolean;
}
export interface ConsoleContext { key: string; name: string; url: string; frame: string; top: boolean; depth?: number }
export interface ConsoleState { revision: number; connected: boolean; contexts: ConsoleContext[] }
export interface ConsoleResult { value: ConsoleValue; exception: boolean; elapsed: number; revision: number }
export type ConsoleErrorCode = 'consoleUnavailable' | 'consoleStale' | 'consoleTimeout' | 'consoleBusy' | 'consoleInvalid';

export interface ConsoleProperties { children: { name: string; value: ConsoleValue }[]; nextOffset?: number; total: number; revision: number }
