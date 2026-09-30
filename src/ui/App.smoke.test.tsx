// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';
import App from '../App';

beforeEach(() => {
  localStorage.clear();
});

describe('App UI 冒烟', () => {
  it('首次打开：渲染旧版迁移后的总览，无运行时错误', () => {
    const html = renderToStaticMarkup(React.createElement(App));
    expect(html).toContain('License Lens');
    expect(html).toContain('当前有效裁决');
    expect(html).toContain('2026.03');
    // 迁移来的 5 个包
    expect(html).toContain('legacy-parser');
    // EX-001 有效：react 行经例外沿用
    expect(html).toContain('例外');
  });
});
