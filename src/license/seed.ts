import type {
  DBShape,
  ExceptionApproval,
  IngestBatch,
  LegacyDep,
  PolicyVersion,
  ScanItem,
} from './types';
import {contentFingerprint} from './fingerprint';
import {newBatchId} from './ingest';

/** 当前日期为 2026-09-30，种子时间围绕该日期 */
export const SEED_NOW = '2026-09-30T10:00:00.000Z';

/* ---------------- 策略版本 ---------------- */

export const POLICY_V1: PolicyVersion = {
  id: 'POL-2025.06',
  publishedAt: '2025-06-01T00:00:00.000Z',
  note: '基础许可证规则集',
  defaultLevel: 'review',
  rules: {
    MIT: {level: 'allow', note: '宽松许可，可商用，保留版权声明即可'},
    'BSD-3-Clause': {level: 'review', note: '再发布需保留版权声明与免责条款'},
    'Apache-2.0': {level: 'allow', note: '宽松许可，含专利授权，注意 NOTICE 文件'},
    'GPL-3.0': {level: 'deny', note: '强 Copyleft，与闭源分发冲突'},
    'LGPL-2.1': {level: 'review', note: '动态链接可用，静态链接需开源评审'},
  },
};

export const POLICY_V2: PolicyVersion = {
  id: 'POL-2026.10',
  publishedAt: '2026-09-30T12:00:00.000Z',
  note: '收紧 SSPL / LGPL，新增服务端分发条款',
  defaultLevel: 'review',
  rules: {
    MIT: {level: 'allow', note: '宽松许可，可商用，保留版权声明即可'},
    'BSD-3-Clause': {level: 'review', note: '再发布需保留版权声明与免责条款'},
    'Apache-2.0': {level: 'allow', note: '宽松许可，含专利授权，注意 NOTICE 文件'},
    'GPL-3.0': {level: 'review', note: '新规：单独隔离分发可评审通过，需法务确认'},
    'LGPL-2.1': {level: 'deny', note: '新规：升级为拒绝，静态/动态链接均需隔离'},
    'SSPL-1.0': {level: 'deny', note: '新规：服务端源代码披露义务不可接受'},
  },
};

/* ---------------- 旧版（v1）站内清单 ---------------- */

/** 与旧 App localStorage('license-lens') 的数据形状一致 */
export const LEGACY_DEPS: LegacyDep[] = [
  {id: 1, name: 'react', version: '18.3.1', license: 'MIT', source: 'npm', status: 'ok', note: '宽松许可，可商用'},
  {id: 2, name: 'lodash', version: '4.17.21', license: 'MIT', source: 'npm', status: 'ok', note: '宽松许可，可商用'},
  {id: 3, name: 'chart.js', version: '4.4.4', license: 'MIT', source: 'npm', status: 'ok', note: '宽松许可，可商用'},
  {id: 4, name: 'highlight.js', version: '11.10.0', license: 'BSD-3-Clause', source: 'npm', status: 'warn', note: '再发布需保留版权声明'},
  // 旧库没有包体签名，迁移时按名称/版本/许可证补算指纹；离线扫描包里出现新签名 → 演示「内容变了」
  {id: 5, name: 'legacy-parser', version: '2.1.0', license: 'GPL-3.0', source: '手动', status: 'risk', note: '可能与闭源分发冲突'},
];

/* ---------------- 两批离线扫描包（前后到达） ---------------- */

function item(
  name: string,
  version: string,
  license: string | null,
  filesSignature: string | undefined,
  source: ScanItem['source'],
  scannedAt: string,
): ScanItem {
  return {
    source,
    name,
    version,
    license,
    filesSignature,
    scannedAt,
    fingerprint: contentFingerprint({name, version, license, filesSignature}),
  };
}

export function buildBatchA(): IngestBatch {
  const t = '2026-09-29T09:00:00.000Z';
  return {
    id: newBatchId(),
    label: '离线扫描包 A',
    origin: 'offline-snapshot-air-gap-0929.tar.gz',
    arrivedAt: t,
    state: 'queued',
    attempts: 0,
    items: [
      // 与站内清单同内容 → 指纹相同，只合并来源，不重复入库
      item('react', '18.3.1', 'MIT', undefined, 'offline-scan', t),
      item('lodash', '4.17.21', 'MIT', undefined, 'offline-scan', t),
      item('chart.js', '4.4.4', 'MIT', undefined, 'offline-scan', t),
      item('mime-types', '2.1.35', 'MIT', undefined, 'offline-scan', t),
      item('internal-crypto', '0.9.2', 'SSPL-1.0', undefined, 'offline-scan', t),
    ],
  };
}

export function buildBatchB(): IngestBatch {
  const t = '2026-09-30T10:00:00.000Z';
  return {
    id: newBatchId(),
    label: '离线扫描包 B',
    origin: 'offline-snapshot-air-gap-0930.tar.gz',
    arrivedAt: t,
    state: 'queued',
    attempts: 0,
    // 首次提交模拟写入失败：只保留本批待重试，已入库的 A 批不受影响
    simulateFailureOnce: true,
    items: [
      // 同坐标新包体 → 新指纹，旧裁决失效、回到待复核
      item('highlight.js', '11.10.0', 'BSD-3-Clause', 'sig-hljs-patched-1110', 'offline-scan', t),
      item('legacy-parser', '2.1.0', 'GPL-3.0', 'sig-2026-build31', 'offline-scan', t),
      // 新包，许可证无法识别 → 待复核
      item('fast-xml', '1.4.2', null, undefined, 'offline-scan', t),
      item('internal-crypto', '1.2.0', 'SSPL-1.0', undefined, 'offline-scan', t),
      // 批内重复内容（同一指纹出现两次）→ 只收一次
      item('mime-types', '2.1.35', 'MIT', undefined, 'offline-scan', t),
      item('mime-types', '2.1.35', 'MIT', undefined, 'offline-scan', t),
    ],
  };
}

/* ---------------- 站内例外审批 ---------------- */

export function buildSeedExceptions(): ExceptionApproval[] {
  const legacyParserFp = contentFingerprint({name: 'legacy-parser', version: '2.1.0', license: 'GPL-3.0'});
  const lodashFp = contentFingerprint({name: 'lodash', version: '4.17.21', license: 'MIT'});
  const hljsFp = contentFingerprint({
    name: 'highlight.js',
    version: '11.10.0',
    license: 'BSD-3-Clause',
  });

  return [
    {
      id: 'EX-001',
      ticket: 'SEC-2025-118',
      name: 'legacy-parser',
      version: '2.1.0',
      // 绑定旧包体指纹；B 批新包体指纹不同 → 不可沿用
      fingerprint: legacyParserFp,
      policyVersion: 'POL-2025.06',
      grantedLevel: 'allow',
      approver: '王审计',
      grantedAt: '2025-11-03T09:30:00.000Z',
      expiresAt: null,
      note: '内部隔离模块，不对外分发，历史放行',
    },
    {
      id: 'EX-002',
      ticket: 'SEC-2025-204',
      name: 'lodash',
      version: '4.17.21',
      // 指纹一致，但例外绑定的是旧策略版本 → 新策略下不可沿用
      fingerprint: lodashFp,
      policyVersion: 'POL-2025.06',
      grantedLevel: 'review',
      approver: '李合规',
      grantedAt: '2025-12-15T14:00:00.000Z',
      expiresAt: null,
      note: '历史策略下的评审结论登记',
    },
    {
      id: 'EX-003',
      ticket: 'SEC-2026-031',
      name: 'highlight.js',
      version: '11.10.0',
      // 指纹与站内旧包一致，但已过期（B 批换成新指纹后还会叠加指纹不一致）
      fingerprint: hljsFp,
      policyVersion: 'POL-2025.06',
      grantedLevel: 'allow',
      approver: '周法务',
      grantedAt: '2026-01-10T10:00:00.000Z',
      expiresAt: '2026-09-01T00:00:00.000Z',
      note: '季度临时例外，2026-09-01 到期',
    },
  ];
}

/* ---------------- 初始空库 ---------------- */

export function emptyDB(): DBShape {
  return {
    schemaVersion: 2,
    policies: [POLICY_V1],
    currentPolicyVersion: POLICY_V1.id,
    packages: {},
    coordIndex: {},
    verdicts: [],
    exceptions: buildSeedExceptions(),
    batches: [],
  };
}
