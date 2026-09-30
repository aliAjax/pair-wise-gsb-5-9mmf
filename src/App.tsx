import {useMemo, useState} from 'react';
import {
  AlertTriangle, ArrowLeftRight, Download, FileClock, Gavel, Layers3, PackageOpen,
  RotateCcw, Search, ShieldCheck, ShieldQuestion, Sparkles, UploadCloud,
} from 'lucide-react';
import {useLicenseStore} from './license/store';
import {currentPackages, currentVerdict, pkgCoord} from './license/engine';
import {buildReport, download} from './license/report';
import {ManifestList, type StatusFilter} from './license/components/ManifestList';
import {DetailPanel} from './license/components/DetailPanel';
import {BatchPanel} from './license/components/BatchPanel';
import {ActivityLog, ExceptionsPanel, HistoryPanel, PolicyPanel} from './license/components/Panels';

type Tab = 'manifest' | 'batches' | 'policy' | 'exceptions' | 'history';

const TABS: {id: Tab; label: string; icon: typeof Layers3}[] = [
  {id: 'manifest', label: '当前清单', icon: Layers3},
  {id: 'batches', label: '扫描包接入', icon: UploadCloud},
  {id: 'policy', label: '策略版本', icon: Gavel},
  {id: 'exceptions', label: '例外审批', icon: ShieldCheck},
  {id: 'history', label: '历史结论', icon: FileClock},
];

export default function App() {
  const store = useLicenseStore();
  const {db, logs} = store;
  const [tab, setTab] = useState<Tab>('manifest');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [selectedFp, setSelectedFp] = useState<string | null>(null);
  const [historyView, setHistoryView] = useState(false);

  const rows = useMemo(() => currentPackages(db).map(p => currentVerdict(db, p)), [db]);
  const counts = useMemo(() => {
    const c = {ok: 0, warn: 0, risk: 0, pending: 0};
    for (const r of rows) c[r.status] += 1;
    return c;
  }, [rows]);

  const failedBatches = db.batches.filter(b => b.state === 'pending-retry').length;
  const selectedPkg = selectedFp ? db.packages[selectedFp] ?? null : null;

  const openPkg = (fp: string, history = false) => {
    setSelectedFp(fp);
    setHistoryView(history);
  };

  const exportReport = () => {
    download(`license-report-${db.currentPolicyVersion}.md`, buildReport(db));
  };

  return (
    <div className="shell">
      <aside>
        <div className="brand">
          <div className="brand-icon"><ShieldCheck size={18}/></div>
          <div><b>License Lens</b><small>fingerprint · policy · verdict</small></div>
        </div>
        <div className="nav-title">合规工作台</div>
        {TABS.map(t => (
          <button key={t.id} className={`nav ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>
            <t.icon size={16}/> {t.label}
            {t.id === 'batches' && failedBatches > 0 && <span className="red">{failedBatches} 待重试</span>}
            {t.id === 'manifest' && counts.pending > 0 && <span className="amber">{counts.pending} 待复核</span>}
          </button>
        ))}
        <div className="aside-bottom">
          <div className="mini-card">
            <Sparkles size={16}/>
            <div>
              <b>当前策略 {db.currentPolicyVersion}</b>
              <small>{db.policies.find(p => p.id === db.currentPolicyVersion)?.note}</small>
            </div>
          </div>
          <button className="reset-btn" onClick={store.resetDemo}><RotateCcw size={13}/> 重置演示数据</button>
        </div>
      </aside>

      <main>
        <header>
          <div>
            <div className="crumb">WORKSPACE / <b>DEPENDENCY GOVERNANCE</b></div>
            <h1>依赖许可证裁决</h1>
            <p>内容指纹去重 · 策略版本绑定 · 例外条件校验 · 批次原子写入 · 旧数据迁移</p>
          </div>
          <div className="head-actions">
            <button className="outline" onClick={exportReport}><Download size={15}/> 导出当前有效裁决报告</button>
            <button className="outline" onClick={() => setTab('batches')}><UploadCloud size={15}/> 接入扫描包</button>
          </div>
        </header>

        {db.migratedAt && (
          <div className="migration-banner">
            <ArrowLeftRight size={15}/>
            <span>
              旧版站内清单已于首次打开时迁移到 v2：{db.legacyCount} 个包补全内容指纹并绑定策略版本
              <b> {db.currentPolicyVersion}</b>，历史结论保留可查；清单与统计只显示当前有效裁决。
            </span>
          </div>
        )}

        {failedBatches > 0 && (
          <div className="migration-banner warn">
            <AlertTriangle size={15}/>
            <span>有 {failedBatches} 个扫描包写入失败，已保留待重试；已入库记录不受影响。</span>
            <button className="mini-primary" onClick={store.retryAllFailed}>立即重试</button>
          </div>
        )}

        <section className="summary">
          <div><span>当前包总数（按指纹）</span><b>{rows.length}</b><small>内容相同只计一次</small></div>
          <div><span>放行</span><b className="teal">{counts.ok}</b><small>含沿用的有效例外</small></div>
          <div><span>需复核 / 拒绝</span><b className="orange">{counts.warn + counts.risk}</b><small>复核 {counts.warn} · 拒绝 {counts.risk}</small></div>
          <div><span>待复核</span><b className="red">{counts.pending}</b><small>内容变化 / 策略升级 / 未知许可证</small></div>
        </section>

        {tab === 'manifest' && (
          <section className="workspace">
            <div className="table-pane">
              <div className="pane-head">
                <div><h2>当前清单</h2><p>同一内容指纹只出现一次；失效旧裁决不显示</p></div>
                <div className="tools">
                  <div className="search"><Search size={15}/><input value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索包 / 指纹"/></div>
                  <select value={filter} onChange={e => setFilter(e.target.value as StatusFilter)}>
                    <option value="all">全部状态</option>
                    <option value="ok">放行</option>
                    <option value="warn">需复核</option>
                    <option value="risk">拒绝</option>
                    <option value="pending">待复核</option>
                  </select>
                  <button className="outline mini" disabled={counts.pending === 0} onClick={store.readjudicatePending} title="未知许可证仍会保留待人工">
                    <Gavel size={13}/> 全部按当前策略重裁
                  </button>
                </div>
              </div>
              <ManifestList db={db} query={query} filter={filter} selectedFp={selectedFp} onSelect={fp => openPkg(fp, false)}/>
            </div>
            <DetailPanel
              db={db}
              pkg={selectedPkg}
              isHistory={historyView}
              onClose={() => setSelectedFp(null)}
              onReadjudicate={store.readjudicateOne}
              onReview={store.review}
            />
          </section>
        )}

        {tab === 'batches' && (
          <section className="workspace wide">
            <BatchPanel db={db} onReceive={store.receiveBatch} onCommit={store.commit} onRetryAll={store.retryAllFailed}/>
            <ActivityLog logs={logs}/>
          </section>
        )}

        {tab === 'policy' && <PolicyPanel db={db} onBump={store.bumpPolicy}/>}
        {tab === 'exceptions' && <ExceptionsPanel db={db} onAdd={store.addException}/>}
        {tab === 'history' && (
          <section className="workspace wide">
            <HistoryPanel db={db} query={query} onSelect={fp => openPkg(fp, true)}/>
            {selectedPkg && historyView && (
              <DetailPanel db={db} pkg={selectedPkg} isHistory onClose={() => setSelectedFp(null)} onReadjudicate={store.readjudicateOne} onReview={store.review}/>
            )}
            {!selectedPkg && (
              <div className="detail empty-detail">
                <PackageOpen size={28}/>
                <p>在左侧选择任意历史包（包括被新内容替换的），查看其失效裁决与历史结论。</p>
              </div>
            )}
          </section>
        )}

        <footer className="foot-note">
          <ShieldQuestion size={13}/>
          清单、统计与报告仅基于当前有效裁决；失效记录只存在于历史查询中。
          {rows.some(r => r.pkg.sources.length > 1) && (
            <span className="merge-note">
              已合并来源：{rows.filter(r => r.pkg.sources.length > 1).map(r => pkgCoord(r.pkg)).join('、')}
            </span>
          )}
        </footer>
      </main>
    </div>
  );
}
