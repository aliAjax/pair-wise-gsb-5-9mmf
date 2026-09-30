import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Archive,
  ChevronDown,
  Database,
  Gavel,
  GitBranch,
  HardDriveDownload,
  Layers3,
  RotateCcw,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { useStore } from './state/store';
import { Overview } from './ui/Overview';
import { ScanBatches } from './ui/ScanBatches';
import { Adjudication } from './ui/Adjudication';
import { Exceptions } from './ui/Exceptions';
import { Policy } from './ui/Policy';
import { HistoryArchive } from './ui/HistoryArchive';
import { currentRulings } from './domain/report';

type View = 'overview' | 'batches' | 'adjudication' | 'exceptions' | 'policy' | 'history';

const NAV: { id: View; label: string; icon: typeof Layers3 }[] = [
  { id: 'overview', label: '依赖总览 / 清单', icon: Layers3 },
  { id: 'batches', label: '离线扫描包接入', icon: HardDriveDownload },
  { id: 'adjudication', label: '裁决复核队列', icon: Gavel },
  { id: 'exceptions', label: '例外审批', icon: ShieldCheck },
  { id: 'policy', label: '策略版本 / 站内清单', icon: GitBranch },
  { id: 'history', label: '历史结论档案', icon: Archive },
];

export default function App() {
  const { state, actions, now } = useStore();
  const [view, setView] = useState<View>('overview');

  const pendingCount = useMemo(
    () => currentRulings(state, now()).filter((r) => r.ruling.decision === 'pending').length,
    [state, now],
  );
  const failedBatches = state.batches.filter((b) => b.status === 'failed').length;

  return (
    <div className="shell">
      <aside>
        <div className="brand">
          <div className="brand-icon"><ShieldCheck size={18}/></div>
          <div><b>License Lens</b><small>dependency clarity</small></div>
        </div>
        <div className="nav-title">WORKSPACE</div>
        {NAV.map((n) => (
          <button key={n.id} className={view === n.id ? 'nav active' : 'nav'} onClick={() => setView(n.id)}>
            <n.icon size={16}/> {n.label}
            {n.id === 'adjudication' && pendingCount > 0 && <span className="red">{pendingCount}</span>}
            {n.id === 'batches' && failedBatches > 0 && <span className="red">{failedBatches}</span>}
          </button>
        ))}

        <div className="aside-bottom">
          <div className="mini-card">
            <GitBranch size={16}/>
            <div>
              <b>策略 {state.policy.version}</b>
              <small>裁决/例外均按此版本锁定</small>
            </div>
          </div>
          <div className="mini-card migration-card" title="旧数据首次打开时迁移">
            <Sparkles size={16}/>
            <div>
              <b>旧版数据已迁移</b>
              <small>补登内容指纹与策略版本，历史结论可在档案中查询</small>
            </div>
          </div>
          <button className="reset-btn" onClick={actions.reset} title="重新从旧版数据迁移（演示用）">
            <RotateCcw size={13}/> 重置演示
          </button>
          <div className="user">
            <div className="avatar">ZL</div><span>Zen Li</span><ChevronDown size={14}/>
          </div>
        </div>
      </aside>

      <main>
        <header>
          <div>
            <div className="crumb">WORKSPACE / <b>PROJECT SCAN</b></div>
            <h1>{NAV.find((n) => n.id === view)!.label}</h1>
            <p>内容指纹去重 · 指纹/策略双匹配裁决 · 例外三条件沿用 · 批次原子写入</p>
          </div>
          <div className="head-actions">
            <span className="policy-pill"><Database size={13}/> 当前策略版本 <b>{state.policy.version}</b></span>
            {pendingCount > 0 && (
              <span className="warn-pill"><AlertTriangle size={13}/> {pendingCount} 个包待复核</span>
            )}
          </div>
        </header>

        {view === 'overview' && <Overview state={state} now={now()} actions={{ grant: actions.grant }}/>}
        {view === 'batches' && <ScanBatches state={state} now={now()} actions={{ ingest: actions.ingest }}/>}
        {view === 'adjudication' && <Adjudication state={state} now={now()} actions={{ decide: actions.decide, grant: actions.grant }}/>}
        {view === 'exceptions' && <Exceptions state={state} now={now()} actions={{ revoke: actions.revoke }}/>}
        {view === 'policy' && <Policy state={state} now={now()} actions={{ publishPolicy: actions.publishPolicy, upsertManifest: actions.upsertManifest }}/>}
        {view === 'history' && <HistoryArchive state={state} now={now()}/>}
      </main>
    </div>
  );
}
