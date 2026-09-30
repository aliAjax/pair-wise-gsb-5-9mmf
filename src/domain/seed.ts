import { BatchItem, License, ScanBatch, SiteException } from './types';
import { contentFingerprint, packageKey } from './fingerprint';
import { LegacyDep } from './engine';

// 固定的演示时间锚点（2026-09-30 10:00:00 UTC）
export const T0 = Date.UTC(2026, 8, 30, 10, 0, 0);
const DAY = 86400000;

export const CURRENT_POLICY_VERSION = '2026.03';

/** 旧版（v1）数据：缺指纹、缺策略版本，首次打开时迁移 */
export const LEGACY_DEPS: LegacyDep[] = [
  { id: 1, name: 'react', version: '18.3.1', license: 'MIT', source: 'npm', status: 'ok', note: '宽松许可，可商用' },
  { id: 2, name: 'lodash', version: '4.17.21', license: 'MIT', source: 'npm', status: 'ok', note: '宽松许可，可商用' },
  { id: 3, name: 'chart.js', version: '4.4.4', license: 'MIT', source: 'npm', status: 'ok', note: '宽松许可，可商用' },
  { id: 4, name: 'highlight.js', version: '11.10.0', license: 'BSD-3-Clause', source: '手动', status: 'warn', note: '再发布需保留版权声明' },
  { id: 5, name: 'legacy-parser', version: '2.1.0', license: 'GPL-3.0', source: '手动', status: 'risk', note: '可能与闭源分发冲突' },
];

function item(name: string, version: string, license: License, contentCode: string): BatchItem {
  return { name, version, license, contentCode };
}

/** 第一批离线扫描包：含换代、全新包和批内重复 */
export const BATCH_A: ScanBatch = {
  id: 'scan-2026-0930-A',
  label: '离线扫描包 A · 2026-09-30 08:00',
  arrivedAt: T0 - 2 * 3600000,
  status: 'pending',
  attempts: 0,
  error: null,
  items: [
    // 内容变化（版本号变、内容代码变）→ 新指纹，原裁决失效回待复核
    item('react', '18.3.2', 'MIT', 'react-core-18.3.2#bundle'),
    item('lodash', '4.17.22', 'MIT', 'lodash-src-4.17.22#tar'),
    // 全新包：按策略默认自动初判
    item('dayjs', '1.11.13', 'MIT', 'dayjs-1.11.13#src'),
    item('ajv', '8.17.1', 'MIT', 'ajv-8.17.1#dist'),
    // 与清单旧版同内容（contentCode 与迁移记录一致）→ 指纹已存在，去重
    item('react', '18.3.1', 'MIT', 'legacy-content@18.3.1'),
    item('chart.js', '4.4.4', 'MIT', 'legacy-content@4.4.4'),
  ],
};

/** 第二批：含一个损坏条目 → 整批原子失败、保留待重试 */
export const BATCH_B: ScanBatch = {
  id: 'scan-2026-0930-B',
  label: '离线扫描包 B · 2026-09-30 09:00',
  arrivedAt: T0 - 3600000,
  status: 'pending',
  attempts: 0,
  error: null,
  items: [
    item('micromatch', '4.0.8', 'MIT', 'micromatch-4.0.8#packed'),
    item('chalk', '5.3.0', 'MIT', 'chalk-5.3.0#esm'),
    // 与 A 批 dayjs 内容完全相同 → 跨批按指纹去重
    item('dayjs', '1.11.13', 'MIT', 'dayjs-1.11.13#src'),
    // 高风险全新包
    item('readline-sync', '1.4.10', 'GPL-3.0', 'readline-sync-1.4.10#gz'),
    // 损坏条目（离线介质校验不通过）→ 整批失败
    { ...item('broken-pkg', '0.9.0', 'UNKNOWN', 'broken-0.9#chunk'), corrupt: true },
  ],
};

export function buildSeedExceptions(): SiteException[] {
  const legacyReactFp = contentFingerprint({
    name: packageKey('react'),
    version: '18.3.1',
    license: 'MIT',
    contentCode: 'legacy-content@18.3.1',
  });
  const legacyParserFp = contentFingerprint({
    name: packageKey('legacy-parser'),
    version: '2.1.0',
    license: 'GPL-3.0',
    contentCode: 'legacy-content@2.1.0',
  });
  const legacyHighlightFp = contentFingerprint({
    name: packageKey('highlight.js'),
    version: '11.10.0',
    license: 'BSD-3-Clause',
    contentCode: 'legacy-content@11.10.0',
  });

  return [
    {
      // 指纹匹配（react 旧内容）+ 当前策略版本 + 未过期 → 可沿用
      id: 'EX-001',
      key: packageKey('react'),
      fingerprint: legacyReactFp,
      policyVersion: CURRENT_POLICY_VERSION,
      grantedBy: '合规委员会',
      reason: '核心渲染库，法务已确认分发条款',
      grantedAt: T0 - 20 * DAY,
      expiresAt: T0 + 10 * DAY,
    },
    {
      // 例外签发于旧策略 2025.12 → 策略版本不一致，不可沿用
      id: 'EX-002',
      key: packageKey('legacy-parser'),
      fingerprint: legacyParserFp,
      policyVersion: '2025.12',
      grantedBy: '合规委员会',
      reason: '历史项目闭源分发例外（旧策略签发）',
      grantedAt: T0 - 120 * DAY,
      expiresAt: T0 + 120 * DAY,
    },
    {
      // 已过期 → 不可沿用
      id: 'EX-003',
      key: packageKey('highlight.js'),
      fingerprint: legacyHighlightFp,
      policyVersion: CURRENT_POLICY_VERSION,
      grantedBy: '合规委员会',
      reason: '保留声明义务的临时例外（已到期未续）',
      grantedAt: T0 - 60 * DAY,
      expiresAt: T0 - 5 * DAY,
    },
  ];
}
