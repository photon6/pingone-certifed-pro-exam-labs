const BINDING_MESSAGE_PATTERN = /^[A-Za-z0-9_-]{1,8}$/;

export const DEFAULT_CIBA_BINDING_MESSAGE = 'PingLab';

export function normalizeBindingMessage(value, fallback = DEFAULT_CIBA_BINDING_MESSAGE) {
  const raw = (value || fallback).trim();
  if (!BINDING_MESSAGE_PATTERN.test(raw)) {
    throw new Error(
      'binding_message must be 1–8 characters using only letters, numbers, hyphen (-), or underscore (_).',
    );
  }
  return raw;
}

export function bindingMessageHint() {
  return '1–8 characters: A–Z, a–z, 0–9, hyphen, underscore (no spaces).';
}
