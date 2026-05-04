export const SENSITIVE_KEYWORDS = [
  'password',
  'pwd',
  'passcode',
  '验证码',
  '短信码',
  'token',
  'secret',
  'cookie',
  'authorization'
];

const normalize = (value?: string) => (value ?? '').toLowerCase();

export function maskSensitiveValue(value: string): string {
  if (!value) {
    return '';
  }
  return '*'.repeat(Math.min(Math.max(value.length, 6), 12));
}

export function isSensitiveField(input: {
  type?: string;
  name?: string;
  id?: string;
  label?: string;
  placeholder?: string;
}): boolean {
  const haystack = [
    input.type,
    input.name,
    input.id,
    input.label,
    input.placeholder
  ]
    .map(normalize)
    .join(' ');

  return SENSITIVE_KEYWORDS.some((keyword) => haystack.includes(keyword.toLowerCase()));
}
