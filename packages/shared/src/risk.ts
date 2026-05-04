export const RISK_KEYWORDS = [
  '验证码',
  '短信验证',
  '短信码',
  '安全验证',
  '风控校验',
  '人机验证',
  '滑块验证',
  '身份验证',
  '二次验证',
  '登录失效',
  '重新登录',
  'captcha',
  'verification',
  'risk control',
  'login expired'
];

export const HIGH_RISK_ACTION_KEYWORDS = [
  '删除',
  '发布',
  '改价',
  '库存',
  '库存调整',
  '保存',
  'delete',
  'publish',
  'price',
  'inventory',
  'save'
];

const includesAny = (text: string, keywords: string[]) => {
  const normalized = text.toLowerCase();
  return keywords.some((keyword) => normalized.includes(keyword.toLowerCase()));
};

export function detectManualIntervention(text: string): boolean {
  return includesAny(text, RISK_KEYWORDS);
}

export function detectHighRiskAction(text: string): boolean {
  return includesAny(text, HIGH_RISK_ACTION_KEYWORDS);
}
