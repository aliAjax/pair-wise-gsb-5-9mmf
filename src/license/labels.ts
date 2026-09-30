import type {CurrentStatus, PackageSource, RiskLevel, Verdict, VerdictSource} from './types';

export const STATUS_META: Record<CurrentStatus, {label: string; cls: string}> = {
  ok: {label: '放行', cls: 'ok'},
  warn: {label: '需复核', cls: 'warn'},
  risk: {label: '拒绝', cls: 'risk'},
  pending: {label: '待复核', cls: 'pending'},
};

export const LEVEL_LABEL: Record<RiskLevel, string> = {
  allow: '放行',
  review: '需复核',
  deny: '拒绝',
};

export const SOURCE_LABEL: Record<PackageSource, string> = {
  'site-manifest': '站内清单',
  'offline-scan': '离线扫描',
  manual: '手动',
};

export const VERDICT_SOURCE_LABEL: Record<VerdictSource, string> = {
  'policy-auto': '策略自动裁决',
  manual: '人工复核',
  'legacy-migrated': '历史结论迁移',
};

export const SUPERSEDE_TEXT: Record<NonNullable<Verdict['reasonSuperseded']>, string> = {
  'content-changed': '包内容变化，裁决失效',
  'policy-updated': '策略版本升级，裁决失效',
};

export function shortFp(fp: string): string {
  return fp.slice(0, 13) + '…';
}

export function fmtTime(iso: string): string {
  try {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch {
    return iso;
  }
}
