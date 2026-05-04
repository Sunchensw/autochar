import { describe, expect, test } from 'vitest';
import { shouldCapturePageStateScreenshot, type PageScreenshotState } from '../src';

const baseState: PageScreenshotState = {
  url: 'http://localhost:4173/products',
  title: 'Products',
  scrollX: 0,
  scrollY: 0,
  navigationRevision: 1
};

describe('shouldCapturePageStateScreenshot', () => {
  test('captures the first screenshot when no previous state exists', () => {
    expect(shouldCapturePageStateScreenshot(undefined, baseState)).toBe(true);
  });

  test('reuses the existing screenshot when page state is unchanged', () => {
    expect(shouldCapturePageStateScreenshot(baseState, { ...baseState })).toBe(false);
  });

  test('captures again when the page scroll position changes', () => {
    expect(shouldCapturePageStateScreenshot(baseState, { ...baseState, scrollY: 640 })).toBe(true);
  });

  test('captures again when URL or title changes', () => {
    expect(shouldCapturePageStateScreenshot(baseState, { ...baseState, url: 'http://localhost:4173/detail' })).toBe(true);
    expect(shouldCapturePageStateScreenshot(baseState, { ...baseState, title: 'Detail' })).toBe(true);
  });

  test('captures again when the page refreshes with the same URL and title', () => {
    expect(shouldCapturePageStateScreenshot(baseState, { ...baseState, navigationRevision: 2 })).toBe(true);
  });
});
