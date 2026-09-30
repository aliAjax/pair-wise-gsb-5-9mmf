import { Decision } from '../domain/types';

export function fmtTime(t: number): string {
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function fmtDate(t: number): string {
  return fmtTime(t).slice(0, 10);
}

export const decisionMeta: Record<Decision | 'pending', { zh: string; cls: string }> = {
  allow: { zh: '允许', cls: 'ok' },
  review: { zh: '复核', cls: 'warn' },
  deny: { zh: '拒绝', cls: 'risk' },
  pending: { zh: '待复核', cls: 'warn' },
};

export function download(filename: string, content: string, mime = 'text/markdown') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type: mime }));
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
