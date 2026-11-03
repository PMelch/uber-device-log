/** Preserve string-convertible codes; absent or non-convertible JSON uses unknownOutcome. */
export function flowErrorCodeValue(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  try {
    return String(value);
  } catch {
    // JSON objects (including array elements) can shadow toString with data.
    return undefined;
  }
}
