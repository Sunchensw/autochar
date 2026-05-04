import { describe, expect, test } from 'vitest';
import {
  detectHighRiskAction,
  detectManualIntervention,
  isSensitiveField,
  maskSensitiveValue
} from '../src';

describe('sensitive field detection', () => {
  test('password inputs are sensitive', () => {
    expect(isSensitiveField({ type: 'password', name: 'login_password' })).toBe(true);
  });

  test('maskSensitiveValue does not preserve clear text', () => {
    expect(maskSensitiveValue('secret123')).toBe('*********');
  });
});

describe('risk detection', () => {
  test.each(['验证码', '短信验证', '登录失效'])('%s requires manual intervention', (keyword) => {
    expect(detectManualIntervention(`页面出现${keyword}`)).toBe(true);
  });

  test.each(['删除', '发布', '改价', '库存', '保存'])('%s is high-risk', (keyword) => {
    expect(detectHighRiskAction(`点击${keyword}`)).toBe(true);
  });
});
