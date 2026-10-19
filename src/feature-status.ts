import type { MessageKey } from './i18n/en';

export type FeatureStatus = 'alpha' | 'beta' | 'preview';
export const featureStatusCopy = {
  alpha: { label: 'featureAlpha', description: 'featureAlphaDescription' },
  beta: { label: 'featureBeta', description: 'featureBetaDescription' },
  preview: { label: 'featurePreview', description: 'featurePreviewDescription' },
} as const satisfies Record<FeatureStatus, { label: MessageKey; description: MessageKey }>;

/** Set a feature to undefined when stable; every associated badge disappears. */
export const featureStatuses: Record<'javascriptConsole', FeatureStatus | undefined> = {
  javascriptConsole: 'alpha',
};
