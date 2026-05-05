export function encodeHeaderValue(value: string) {
  return encodeURIComponent(value);
}

export function decodeHeaderValue(value: string | undefined, fallback = "") {
  if (!value) return fallback;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
