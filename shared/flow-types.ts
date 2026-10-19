import type { LogMessage } from './types.js';
export type FlowOutcome = 'running' | 'completed' | 'failed' | 'cancelled' | 'timed_out' | 'interrupted';
export interface FlowReference { step: string; field: string }
export interface FlowMatcher {
  source?: 'any' | 'device' | 'webview'; platform?: 'ios' | 'android'; tag?: string; level?: string;
  contains?: string; regex?: string;
  json?: { path: string; equals?: string | number | boolean | null; equalsFrom?: FlowReference };
  all?: FlowMatcher[];
}
export interface FlowExtractor { json?: string; regex?: string; group?: string; required?: boolean; sensitive?: boolean }
export interface FlowStep { id: string; shortLabel?: string; name: string; optional?: boolean; match: FlowMatcher; extract?: Record<string, FlowExtractor>; next?: string[]; outcome?: 'completed' | 'failed' | 'cancelled' }
export interface FlowError { id: string; appliesTo: 'active' | string[]; match: FlowMatcher; extract?: Record<string, FlowExtractor>; codeField: string; codes: Record<string, { description: string; outcome: 'failed' | 'cancelled' }>; unknownOutcome: 'failed' | 'cancelled' }
export interface FlowBlueprint { version: 1; id: string; name: string; description?: string; start: string; timeout: string; correlation: { scope: 'device-session'; primary: string; aliases?: string[] }; steps: FlowStep[]; errors?: FlowError[] }
export interface FlowDiagnostic { code: 'flowsDiagnostic'; params: { detail: string }; message: string; file?: string; line?: number; column?: number; path?: string }
export interface FlowBlueprintFile { filename: string; source: string; revision: string }
export interface FlowSnapshot { enabled: boolean; projectName: string; directory: string; revision: string; token?: string; blueprints: FlowBlueprint[]; files: FlowBlueprintFile[]; diagnostics: FlowDiagnostic[] }
export interface FlowObservation { stepId: string; message: LogMessage; receivedAt: number; payload: Record<string, unknown>; errorCode?: string; errorDescription?: string; matchedBy?: string[]; accepted?: boolean }
export interface FlowInstance { id: string; epoch: number; blueprint: FlowBlueprint; revision: string; deviceId: string; outcome: FlowOutcome; completeness: 'complete' | 'missing_start' | 'missing_steps' | 'capture_gap' | 'ambiguous'; startedAt: number; updatedAt: number; endedAt?: number; timeoutAt: number; observations: FlowObservation[]; expected: string[]; bindings: Record<string, string | number | boolean>; errorCode?: string; errorDescription?: string; lateOutcome?: FlowOutcome }
export interface FlowEngineState { instances: FlowInstance[]; gaps: number }
