import type { LogMessage } from './types.js';
import type { Notification } from './notifications.js';

/** Internal v1 contract; not yet an external plugin loading API. */
export const PROVIDER_API_VERSION = 1 as const;
export interface TargetCapabilities {
  readonly logs: true;
  /** Advertisement only: execution requires a separate explicit user action. */
  readonly javascript?: { readonly sideEffects: true; readonly requiresExplicitRequest: true };
}
export interface ProviderTarget {
  readonly id: string;
  readonly providerId: string;
  readonly parentId?: string;
  readonly name: string;
  readonly state: string;
  readonly capabilities: TargetCapabilities;
}
export interface CaptureRecord extends LogMessage {
  readonly schemaVersion: 1;
  readonly targetId: string;
  readonly providerId: string;
  /** Original normalized transport record, before viewer limits; NOT wire bytes. */
  readonly raw: Readonly<LogMessage>;
}
export interface CaptureEnd {
  readonly code: 'transport-ended';
  readonly reason: Notification | string;
}
export interface CaptureSink {
  /** Synchronous, no queue; consumers must not throw or retain without bounds. */
  record(record: CaptureRecord): void;
  end(event: CaptureEnd): void;
}
export interface CaptureSession {
  /** Startup failure rejects. Cancellation is silent; late resources are released. */
  readonly ready: Promise<void>;
  /** Idempotent, suppresses subsequent callbacks immediately. */
  dispose(): void;
}
export interface LogProvider<T extends ProviderTarget = ProviderTarget> {
  readonly apiVersion: typeof PROVIDER_API_VERSION;
  readonly id: string;
  /** Discovery snapshots may be stale; callers revalidate before opening. */
  discover(signal?: AbortSignal): Promise<readonly T[]>;
  open(target: T, sink: CaptureSink, signal?: AbortSignal): CaptureSession;
}
