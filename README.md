# License Lens — 依赖合规裁决（指纹 / 策略 / 批次 / 例外）

把离线依赖扫描包与站内清单合并、按策略版本出具许可证裁决的工作台。

## 五条核心规则

1. **同一内容指纹只收一次**
   指纹由 `名称 + 版本 + 许可证 + 包体签名` 确定性哈希得到（`src/license/fingerprint.ts`）。
   指纹相同的包（无论来自站内清单还是第几批扫描、批内出现几次）只合并来源与发现时间，不产生新记录、不产生新裁决。

2. **包内容一变，原裁决失效，回到待复核**
   同名同版本但指纹不同 = 包内容变了：旧包标记 `supersededBy`，旧裁决置
   `supersededAt + reason=content-changed` 但**不删除**；新指纹 `activeVerdictId=null`，
   当前清单显示「待复核 · 包内容已变化」。

3. **站内例外只在三个条件同时满足时沿用**
   包指纹一致 **且** 裁决策略版本一致 **且** 未过期/未撤销（`exceptionStateFor`）。
   任一不满足，界面逐条列出失效原因（指纹不一致 / 策略版本不一致 / 已过期 / 已撤销）。

4. **批次原子提交，失败只保留该批待重试**
   批次先在副本上构建完整结果，再模拟持久化写入：
   - 成功 → 整批一次性入库；
   - 失败 → 包与裁决的改动全部回滚，只有该批次自身变为 `pending-retry`（记录尝试次数与错误），
     已提交的其它批次完全不受影响；重试成功后整批入库。

5. **旧数据首次打开迁移；历史可查、当前只显示有效裁决**
   检测旧版 `localStorage('license-lens')` 扁平清单，迁移到 v2 库时为每个包**补算内容指纹**、
   把历史结论转成绑定**当前策略版本**的 `legacy-migrated` 裁决。旧包与失效裁决只出现在
   「历史结论」页与详情的裁决史中；清单、统计、导出报告一律基于 `currentVerdict()`。

策略版本升级时（策略页发布 `POL-2026.10`），所有绑定旧版本的当前裁决以
`reason=policy-updated` 失效，相关包回到待复核；可一键或逐包按新策略重裁，
许可证未识别的包保留待人工复核。

## 目录

- `src/license/types.ts` — 领域模型
- `src/license/fingerprint.ts` — 内容指纹
- `src/license/engine.ts` — 策略匹配、例外适用性、当前有效裁决推导（唯一的「当前结论」出口）
- `src/license/ingest.ts` — 批次原子提交、策略发布、（重新）裁决、人工复核、旧数据迁移
- `src/license/report.ts` — 只含当前有效裁决的 Markdown 报告
- `src/license/store.ts` — 不依赖 React 的 `LicenseController` + React 绑定（localStorage 持久化）
- `src/license/seed.ts` — 两版策略、旧版清单、两批离线扫描包、三条例外
- `src/license/*.test.ts` — 规则单测与端到端测试（共 13 项）

## 演示路径

1. 打开即看到旧版 5 条清单已迁移（补指纹、绑定 `POL-2025.06`）；
2. 「扫描包接入」→ 接收 A → 提交（react/lodash/chart.js 同指纹只合并来源，新增 mime-types、internal-crypto）；
3. 接收 B → 提交（首次写入失败，整批回滚为待重试，A 批数据不变）→ 重试成功；
   highlight.js / legacy-parser 新包体 → 待复核；fast-xml 许可证未知 → 待人工；
   mime-types 批内重复只收一次；
4. 包详情查看：例外 EX-001/002/003 各自的失效原因、完整裁决史；
5. 「策略版本」发布 `POL-2026.10`：旧结论批量失效；「全部按当前策略重裁」
   （SSPL 变拒绝、GPL 变需复核；未知许可证仍待人工）；
6. 「例外审批」可登记绑定当前指纹与策略版本的新例外；
7. 「历史结论」可查所有被替换包与失效裁决；导出报告只含当前有效裁决。

## 命令

```bash
npm install
npm test     # 13 项规则与端到端测试
npm run dev  # 本地预览
npm run build
```
