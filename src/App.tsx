import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowDownLeft, ArrowDownToLine, ArrowRight, ArrowUpRight, BarChart3, CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight, CircleHelp, Clock3, Database, ExternalLink, Home, Info, LayoutDashboard, Leaf, LoaderCircle, Menu, RefreshCw, Search, Settings2, SlidersHorizontal, Sparkles, Table2, TrendingUp, Wallet, X, Zap, ZoomIn } from 'lucide-react';
import { Area, Bar, Brush, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { analyze, defaultSettings, demoFeeds, loadFeeds, numeric, type Feed, type Settings } from './data';
import { formatDate, formatNumber, fromInput, presetRange, TIME_ZONE, toInput, type Granularity, type Range } from './time';

type View = 'overview' | 'analysis' | 'data' | 'settings';
type Source = 'live' | 'demo';
type Metric = 'energy' | 'power' | 'counter';
const colors = { importEnergy: '#d8813e', exportEnergy: '#608a76', power: '#7b85be', importCounter: '#d8813e', exportCounter: '#608a76' };
const metricLabels: Record<string, string> = { importEnergy: 'Netzbezug', exportEnergy: 'Einspeisung', power: 'Leistung', importCounter: 'Bezugszähler', exportCounter: 'Einspeisezähler' };
const navigation: { id: View; label: string; icon: typeof Home }[] = [
  { id: 'overview', label: 'Übersicht', icon: LayoutDashboard }, { id: 'analysis', label: 'Verbrauchsanalyse', icon: BarChart3 }, { id: 'data', label: 'Messwerte', icon: Table2 }, { id: 'settings', label: 'Einstellungen', icon: Settings2 },
];
function savedSettings(): Settings {
  try { return { ...defaultSettings, ...JSON.parse(localStorage.getItem('strom-ott-settings') || '{}') }; } catch { return defaultSettings; }
}
function downloadCsv(headers: string[], rows: (string | number | null)[][], name: string) {
  const escape = (value: string | number | null) => `"${String(value ?? '').replaceAll('"', '""')}"`;
  const csv = '\uFEFF' + [headers, ...rows].map(row => row.map(escape).join(';')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function Card({ title, value, unit, note, icon, accent = false }: { title: string; value: number | null; unit: string; note: string; icon: ReactNode; accent?: boolean }) {
  return <article className={`stat-card ${accent ? 'accent' : ''}`}><div className="stat-top"><span>{title}</span><span className="stat-icon">{icon}</span></div><div className="stat-number">{formatNumber(value, unit === 'W' ? 0 : 2)} <span>{unit}</span></div><div className="stat-note">{note}</div></article>;
}
function ChartTooltip({ active, payload, label, metric }: { active?: boolean; payload?: readonly { dataKey?: string | number; value?: number | string; color?: string }[]; label?: string | number; metric: Metric }) {
  if (!active || !payload?.length) return null;
  return <div className="chart-tooltip"><strong>{formatDate(Number(label), { year: 'numeric', hour: '2-digit', minute: '2-digit' })}</strong>{payload.map(item => <div key={item.dataKey}><i style={{ background: item.color }} />{metricLabels[String(item.dataKey)]}<b>{formatNumber(Number(item.value))} {metric === 'power' ? 'W' : 'kWh'}</b></div>)}</div>;
}
export default function App() {
  const initial = useRef(presetRange('week'));
  const [settings, setSettings] = useState<Settings>(savedSettings);
  const [settingsDraft, setSettingsDraft] = useState<Settings>(settings);
  const [view, setView] = useState<View>('overview');
  const [mobileOpen, setMobileOpen] = useState(false);
  const [source, setSource] = useState<Source>('live');
  const [range, setRange] = useState<Range>(initial.current);
  const [from, setFrom] = useState(toInput(new Date(initial.current.start)));
  const [until, setUntil] = useState(toInput(new Date(initial.current.end)));
  const [preset, setPreset] = useState('week');
  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [formError, setFormError] = useState('');
  const [requests, setRequests] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);
  const [lastLoaded, setLastLoaded] = useState<number | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [granularity, setGranularity] = useState<Granularity>('day');
  const [metric, setMetric] = useState<Metric>('energy');
  const [chartType, setChartType] = useState<'area' | 'line' | 'bar'>('bar');
  const [showImport, setShowImport] = useState(true);
  const [showExport, setShowExport] = useState(false);
  const [showZoom, setShowZoom] = useState(false);
  const [minimum, setMinimum] = useState('');
  const [maximum, setMaximum] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [sortAsc, setSortAsc] = useState(false);
  const [saved, setSaved] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const model = useMemo(() => analyze(feeds, range, granularity, settings), [feeds, range, granularity, settings]);
  const filterError = (minimum !== '' && !Number.isFinite(Number(minimum))) || (maximum !== '' && !Number.isFinite(Number(maximum))) || (minimum !== '' && maximum !== '' && Number(minimum) > Number(maximum));
  const filteredBuckets = useMemo(() => model.buckets.filter(row => !filterError && (minimum === '' || row.importEnergy !== null && row.importEnergy >= Number(minimum)) && (maximum === '' || row.importEnergy !== null && row.importEnergy <= Number(maximum))), [model, minimum, maximum, filterError]);
  const chartRows: Record<string, number | null>[] = useMemo(() => {
    if (metric !== 'counter') {
      const matches = new Set(filteredBuckets.map(row => row.timestamp));
      return model.buckets.map(row => matches.has(row.timestamp) ? row : { ...row, importEnergy: null, exportEnergy: null, power: null, peak: null });
    }
    const scale = settings.counterUnit === 'Wh' ? 0.001 : 1;
    // At most 1,500 drawing points, preserving first and last values. Full data remains in CSV.
    const stride = Math.max(1, Math.ceil(model.selected.length / 1500));
    return model.selected.filter((_, index) => index % stride === 0 || index === model.selected.length - 1).map(feed => ({ timestamp: Date.parse(feed.created_at), importCounter: numeric(feed[settings.importField]) === null ? null : Number(feed[settings.importField]) * scale, exportCounter: numeric(feed[settings.exportField]) === null ? null : Number(feed[settings.exportField]) * scale }));
  }, [metric, filteredBuckets, model, settings]);
  const tableRows = useMemo(() => model.selected.filter(feed => {
    const values = [formatDate(Date.parse(feed.created_at), { year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }), feed.entry_id, feed[settings.importField], feed[settings.exportField], feed[settings.powerField]];
    return values.some(v => String(v ?? '').toLocaleLowerCase('de').includes(query.toLocaleLowerCase('de')));
  }).sort((a, b) => (Date.parse(a.created_at) - Date.parse(b.created_at)) * (sortAsc ? 1 : -1)), [model, query, sortAsc, settings]);
  const highest = model.buckets.filter(b => b.importEnergy !== null).sort((a, b) => (b.importEnergy ?? 0) - (a.importEnergy ?? 0))[0];
  const latestTimestamp = model.selected.length ? Date.parse(model.selected.at(-1)!.created_at) : null;
  const isFresh = latestTimestamp !== null && Date.now() - latestTimestamp < 5 * 60000;
  const filterActive = minimum !== '' || maximum !== '';
  const duration = range.end - range.start;

  useEffect(() => {
    const controller = new AbortController(); abortRef.current = controller;
    setLoading(true); setError(''); setRequests(0); setLoaded(false); setFeeds([]);
    if (source === 'demo') {
      setFeeds(demoFeeds(range)); setLoaded(true); setLoading(false); setLastLoaded(Date.now());
      return () => controller.abort();
    }
    loadFeeds(settings.channelId, range, controller.signal, setRequests)
      .then(result => { if (!controller.signal.aborted) { setFeeds(result.feeds); setLoaded(true); setLastLoaded(Date.now()); } })
      .catch(e => { if (!controller.signal.aborted) setError(e instanceof Error && e.name === 'TimeoutError' ? 'ThingSpeak antwortet zu langsam. Bitte die Abfrage erneut starten.' : e instanceof TypeError ? 'ThingSpeak konnte nicht erreicht werden. Prüfe die Internetverbindung und die Freigabe des Kanals.' : e instanceof Error ? e.message : 'Die Daten konnten nicht geladen werden.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [range, source, settings.channelId, refreshKey]);
  useEffect(() => { setPage(0); }, [query, range, sortAsc]);
  useEffect(() => {
    if (!autoRefresh || source !== 'live' || preset === 'custom' || preset === 'yesterday') return;
    const timer = setInterval(() => {
      const next = presetRange(preset); setRange(next); setFrom(toInput(new Date(next.start))); setUntil(toInput(new Date(next.end)));
    }, 60000);
    return () => clearInterval(timer);
  }, [autoRefresh, source, preset]);
  function selectPreset(nextPreset: string) {
    const next = presetRange(nextPreset); setPreset(nextPreset); setRange(next); setFrom(toInput(new Date(next.start))); setUntil(toInput(new Date(next.end))); setFormError('');
    setGranularity(nextPreset === 'today' || nextPreset === 'yesterday' ? 'hour' : 'day');
  }
  function applyRange() {
    try {
      const start = fromInput(from), end = fromInput(until);
      if (start >= end) throw new Error('„Von“ muss vor „Bis“ liegen.');
      if (end - start > 366 * 86400000) throw new Error('Bitte höchstens ein Jahr pro Abfrage auswählen.');
      if (end > Date.now() + 60000) throw new Error('Bitte einen Zeitraum bis höchstens jetzt auswählen.');
      setRange({ start, end }); setPreset('custom'); setFormError('');
      setGranularity(end - start <= 2 * 86400000 ? 'hour' : end - start > 90 * 86400000 ? 'month' : 'day');
    } catch (e) { setFormError((e as Error).message); }
  }
  function refresh() {
    if (preset !== 'custom' && preset !== 'yesterday') selectPreset(preset);
    else setRefreshKey(k => k + 1);
  }
  function exportData() {
    if (view === 'data') downloadCsv(['Zeitpunkt (UTC)', 'ID', `Bezug (${settings.counterUnit})`, `Einspeisung (${settings.counterUnit})`, `Leistung (${settings.powerUnit})`], tableRows.map(f => [f.created_at, f.entry_id, numeric(f[settings.importField]), numeric(f[settings.exportField]), numeric(f[settings.powerField])]), 'strom-ott-messwerte.csv');
    else downloadCsv(['Intervallbeginn (UTC)', 'Erfasster Netzbezug (kWh)', 'Erfasste Einspeisung (kWh)', 'Mittlere Leistung (W)'], filteredBuckets.map(b => [new Date(b.timestamp).toISOString(), b.importEnergy, b.exportEnergy, b.power]), 'strom-ott-verbrauch.csv');
  }
  function saveSettings() {
    if (!/^\d+$/.test(settingsDraft.channelId) || !Number.isFinite(settingsDraft.tariff) || settingsDraft.tariff < 0 || settingsDraft.tariff > 10) { setFormError('Bitte eine gültige Kanal-ID und einen Strompreis zwischen 0 und 10 €/kWh eingeben.'); return; }
    if (new Set([settingsDraft.importField, settingsDraft.exportField, settingsDraft.powerField]).size !== 3) { setFormError('Bitte drei unterschiedliche Messfelder auswählen.'); return; }
    setSettings(settingsDraft); localStorage.setItem('strom-ott-settings', JSON.stringify(settingsDraft)); setSaved(true); setFormError(''); setTimeout(() => setSaved(false), 3000);
  }
  const navTo = (next: View) => { setView(next); setMobileOpen(false); setFormError(''); };
  const title = view === 'analysis' ? 'Verbrauch verstehen.' : view === 'data' ? 'Jeder Messwert zählt.' : view === 'settings' ? 'Ganz nach deinem Maß.' : 'Energie im Blick.';
  const subtitle = view === 'analysis' ? 'Finde die Zeiträume, die den Unterschied machen.' : view === 'data' ? 'Alle Messwerte. Durchsuchbar, sortierbar und exportierbar.' : view === 'settings' ? 'Verbinde deinen Zähler und passe die Auswertung an.' : 'Ein guter Überblick ist der erste Schritt zum bewussten Verbrauch.';
  const visibleSeries = metric === 'power' ? ['power'] : metric === 'counter' ? [...(showImport ? ['importCounter'] : []), ...(showExport ? ['exportCounter'] : [])] : [...(showImport ? ['importEnergy'] : []), ...(showExport ? ['exportEnergy'] : [])];
  const canDraw = chartRows.some(row => visibleSeries.some(key => (row as unknown as Record<string, unknown>)[key] != null));
  const chartTitle = metric === 'energy' ? 'Verbrauch im Verlauf' : metric === 'power' ? 'Leistung im Verlauf' : 'Zählerstände im Verlauf';
  return <div className="app-shell">
    {mobileOpen && <button className="sidebar-backdrop" aria-label="Navigation schließen" onClick={() => setMobileOpen(false)} />}
    <aside className={`sidebar ${mobileOpen ? 'open' : ''}`}>
      <a className="brand" href="#" onClick={e => { e.preventDefault(); navTo('overview'); }}><span className="brand-mark"><Zap size={24} fill="currentColor" strokeWidth={1.5} /></span><span>strom<span className="brand-light">ott</span><small>DEIN ENERGIECOCKPIT</small></span></a>
      <div className="home-label"><span className="home-avatar"><Home size={17} /></span><div>Mein Zuhause<small>Stromzähler · OTT</small></div><ChevronDown size={14} /></div>
      <div className="nav-label">ENTDECKEN</div>
      <nav>{navigation.map(({ id, label, icon: Icon }) => <button key={id} className={view === id ? 'active' : ''} onClick={() => navTo(id)}><Icon size={19} strokeWidth={1.7} /><span>{label}</span>{view === id && <span className="nav-dot" />}</button>)}</nav>
      <div className="sidebar-tip"><div className="tip-icon"><Leaf size={20} /></div><strong>Kleine Schritte.<br />Große Wirkung.</strong><p>Wer seinen Verbrauch kennt, kann bewusster mit Energie umgehen.</p><button onClick={() => navTo('analysis')}>Verbrauch entdecken <ArrowRight size={16} /></button></div>
      <div className="sidebar-source"><span className="source-icon"><Database size={17} /></span><div>Verbunden mit ThingSpeak<small>Kanal {settings.channelId} · öffentlich</small></div><a href={`https://thingspeak.mathworks.com/channels/${settings.channelId}`} target="_blank" rel="noreferrer" aria-label="ThingSpeak-Kanal öffnen"><ExternalLink size={14} /></a></div>
    </aside>
    <div className="main-shell">
      <header className="topbar"><div className="breadcrumb"><button className="mobile-menu icon-button" onClick={() => setMobileOpen(true)} aria-label="Navigation öffnen"><Menu size={22} /></button><Home size={15} /><span>Mein Zuhause</span><ChevronRight size={13} /><strong>{navigation.find(n => n.id === view)?.label}</strong></div><div className="topbar-right"><span className={`connection-badge ${source === 'demo' ? 'demo' : error ? 'offline' : ''}`}><i />{source === 'demo' ? 'Demo-Modus' : loading ? 'Verbinden …' : error ? 'Nicht verbunden' : loaded ? isFresh ? 'Live verbunden' : 'Daten geladen' : 'ThingSpeak'}</span><span className="profile-avatar">OT</span></div></header>
      <main>
        <section className="page-heading"><div><span className="eyebrow"><span /> DEIN STROM. DEIN ÜBERBLICK.</span><h1>{title}</h1><p>{subtitle}</p></div><div className="heading-actions"><button className="icon-button refresh-button" title="Daten aktualisieren" aria-label="Daten aktualisieren" onClick={refresh} disabled={loading}><RefreshCw size={17} className={loading ? 'spinning' : ''} /></button><button className="button dark" onClick={exportData} disabled={!loaded || model.selected.length === 0}><ArrowDownToLine size={16} />CSV exportieren</button></div></section>
        {source === 'demo' && <div className="notice demo-notice"><Sparkles size={17} /><span><strong>Du siehst Beispieldaten.</strong> Diese Werte dienen zum Ausprobieren und stammen nicht aus deinem Kanal.</span><button onClick={() => setSource('live')}>Live-Daten laden <ArrowRight size={15} /></button></div>}
        {error && <div role="alert" className="notice error-notice"><Info size={18} /><span><strong>Verbindung zu ThingSpeak fehlt.</strong> {error}</span><button onClick={refresh}>Erneut versuchen</button><button onClick={() => setSource('demo')}>Demo ansehen</button></div>}
        {view !== 'settings' && <>
          <section className="range-panel panel"><div className="range-top"><h2><CalendarDays size={17} />Zeitraum auswählen</h2><div className="preset-buttons">{[['today', 'Heute'], ['yesterday', 'Gestern'], ['week', '7 Tage'], ['month', '30 Tage']].map(([id, label]) => <button key={id} className={preset === id ? 'selected' : ''} onClick={() => selectPreset(id)}>{label}</button>)}<span className={preset === 'custom' ? 'custom selected' : 'custom'}>Individuell</span></div></div><div className="range-inputs"><label><span>Von</span><input aria-label="Zeitraum von" type="datetime-local" value={from} onChange={e => { setFrom(e.target.value); setPreset('custom'); }} /></label><span className="range-arrow"><ArrowRight size={19} /></span><label><span>Bis</span><input aria-label="Zeitraum bis" type="datetime-local" value={until} onChange={e => { setUntil(e.target.value); setPreset('custom'); }} /></label><span className="timezone"><Clock3 size={14} />Berlin · {TIME_ZONE}</span><button className="button apply-button" onClick={applyRange} disabled={loading}><Search size={17} />Zeitraum anzeigen</button></div>{formError && <p role="alert" className="form-error">{formError}</p>}</section>
          <div className="selection-caption"><span><span className="status-dot" />{formatDate(range.start, { year: 'numeric' })} – {formatDate(range.end, { year: 'numeric' })}<span className="caption-divider">/</span>{loading ? `${requests} Datenabfragen …` : `${formatNumber(model.selected.length, 0)} Messwerte`}</span><label className="auto-label"><input type="checkbox" checked={autoRefresh} onChange={e => setAutoRefresh(e.target.checked)} disabled={source === 'demo' || preset === 'custom' || preset === 'yesterday'} />Automatisch aktualisieren<CircleHelp size={13} aria-label="Aktualisiert relative Zeiträume einmal pro Minute" /></label></div>
          {loading && <div className="loading-line" role="status"><LoaderCircle size={16} className="spinning" />Messwerte werden geladen. Größere Zeiträume werden vollständig in Teilabfragen abgerufen.<button onClick={() => { abortRef.current?.abort(); setLoading(false); setError('Die Datenabfrage wurde abgebrochen.'); }}>Abbrechen</button></div>}
        </>}
        {view !== 'data' && view !== 'settings' && <>
          <section className="stats-grid"><Card title="Netzbezug" value={loaded ? model.importEnergy : null} unit="kWh" note="Erfasster Verbrauch im Zeitraum" icon={<ArrowDownLeft size={19} />} accent /><Card title="Einspeisung" value={loaded ? model.exportEnergy : null} unit="kWh" note="Erfasste Energie zurück ins Netz" icon={<ArrowUpRight size={19} />} /><Card title="Leistungsspitze" value={loaded ? model.peakPower : null} unit="W" note="Höchster gemessener Wert" icon={<Zap size={18} />} /><Card title="Geschätzte Stromkosten" value={loaded ? model.costs : null} unit="€" note={`Bei ${formatNumber(settings.tariff)} €/kWh · ohne Grundpreis`} icon={<Wallet size={18} />} /></section>
          <section className="chart-panel panel"><div className="chart-heading"><div><h2>{chartTitle}</h2><p>{metric === 'energy' ? 'Wann und wie viel Energie du aus dem Netz bezogen hast.' : metric === 'power' ? 'Die mittlere gemessene Leistung je Intervall.' : 'Deine kumulierten Zählerstände in Kilowattstunden.'}</p></div><div className="chart-metric-buttons">{[['energy', 'Verbrauch'], ['power', 'Leistung'], ['counter', 'Zählerstände']].map(([id, label]) => <button key={id} className={metric === id ? 'selected' : ''} onClick={() => setMetric(id as Metric)}>{label}</button>)}</div></div>
            <div className="chart-toolbar"><div className="chart-legend">{metric === 'power' ? <span><i style={{ background: colors.power }} />Mittlere Leistung</span> : <><label><input type="checkbox" checked={showImport} onChange={e => setShowImport(e.target.checked)} /><i style={{ background: colors.importEnergy }} />Netzbezug</label><label><input type="checkbox" checked={showExport} onChange={e => setShowExport(e.target.checked)} /><i style={{ background: colors.exportEnergy }} />Einspeisung</label></>}</div><div className="chart-controls"><label><span className="sr-only">Auflösung</span><select aria-label="Auflösung" value={granularity} disabled={metric === 'counter'} onChange={e => setGranularity(e.target.value as Granularity)}><option value="hour" disabled={duration > 180 * 86400000}>Stündlich</option><option value="day">Täglich</option><option value="month">Monatlich</option></select></label><label><span className="sr-only">Diagrammtyp</span><select aria-label="Diagrammtyp" value={chartType} onChange={e => setChartType(e.target.value as typeof chartType)}><option value="bar">Balken</option><option value="area">Fläche</option><option value="line">Linie</option></select></label><button className={`icon-button ${showZoom ? 'enabled' : ''}`} aria-label="Diagramm-Zoom umschalten" aria-pressed={showZoom} title="Zoom-Bereich einblenden" onClick={() => setShowZoom(v => !v)}><ZoomIn size={17} /></button></div></div>
            <div className="chart-unit">{metric === 'power' ? 'Watt' : 'Kilowattstunden'}</div>
            <div className="chart-container" role="img" aria-label={`${chartTitle}, ${chartRows.length} Zeitintervalle. Die zugehörigen Zahlen stehen in der Intervalltabelle.`}>
            {loaded && canDraw ? <ResponsiveContainer width="100%" height="100%"><ComposedChart data={chartRows} margin={{ top: 12, right: 12, bottom: 8, left: -13 }}><defs>{visibleSeries.map(key => <linearGradient key={key} id={`fill-${key}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={colors[key as keyof typeof colors]} stopOpacity={0.26} /><stop offset="100%" stopColor={colors[key as keyof typeof colors]} stopOpacity={0.015} /></linearGradient>)}</defs><CartesianGrid stroke="#eeeee8" vertical={false} strokeDasharray="3 4" /><XAxis dataKey="timestamp" minTickGap={40} tickFormatter={t => formatDate(Number(t), granularity === 'hour' || metric === 'counter' && duration < 2 * 86400000 ? { hour: '2-digit', minute: '2-digit', day: undefined, month: undefined } : { day: '2-digit', month: '2-digit' })} tickLine={false} axisLine={false} tick={{ fill: '#979a91', fontSize: 11 }} dy={10} /><YAxis tickFormatter={n => formatNumber(n, metric === 'power' ? 0 : 1)} tickLine={false} axisLine={false} tick={{ fill: '#979a91', fontSize: 11 }} width={65} domain={metric === 'counter' ? ['auto', 'auto'] : [0, 'auto']} /><Tooltip content={<ChartTooltip metric={metric} />} cursor={{ fill: '#f1f2eb', opacity: 0.6 }} />{visibleSeries.map(key => chartType === 'bar' ? <Bar key={key} dataKey={key} fill={colors[key as keyof typeof colors]} radius={[5, 5, 0, 0]} maxBarSize={46} isAnimationActive={false} /> : chartType === 'area' ? <Area key={key} dataKey={key} type="linear" stroke={colors[key as keyof typeof colors]} fill={`url(#fill-${key})`} strokeWidth={2.3} isAnimationActive={false} connectNulls={false} /> : <Line key={key} dataKey={key} type="linear" stroke={colors[key as keyof typeof colors]} strokeWidth={2.3} dot={false} isAnimationActive={false} connectNulls={false} />)}{showZoom && <Brush dataKey="timestamp" height={26} stroke="#d7dacf" tickFormatter={t => formatDate(Number(t))} />}</ComposedChart></ResponsiveContainer> : <div className="empty-chart"><span><BarChart3 size={30} /></span><h3>{loading ? 'Deine Daten sind unterwegs' : !showImport && !showExport && metric !== 'power' ? 'Wähle eine Datenreihe aus' : filterActive && loaded ? 'Kein Intervall passt zum Filter' : loaded ? 'Keine Messdaten in diesem Zeitraum' : 'Bereit für deinen Energieüberblick'}</h3><p>{loading ? 'Die Diagramme erscheinen, sobald die Abfrage vollständig ist.' : loaded ? 'Passe Zeitraum, Messfelder oder Verbrauchsfilter an.' : 'Verbinde deinen öffentlichen Kanal oder erkunde die Website mit Beispieldaten.'}</p>{!loading && !loaded && <button className="button" onClick={() => setSource('demo')}><Sparkles size={16} />Mit Beispieldaten erkunden</button>}</div>}
            </div><div className="chart-footer"><span><Info size={14} />{metric === 'energy' ? 'Verbrauch = Differenz der Zählerstände. Intervallgrenzen werden interpoliert.' : metric === 'power' ? 'Arithmetischer Mittelwert der gemessenen Leistungswerte pro Intervall.' : 'Originalwerte; bei vielen Messungen wird die Darstellung ausgedünnt.'}</span><span>{source === 'demo' ? 'Beispieldaten' : 'Quelle: ThingSpeak'} <ExternalLink size={12} /></span></div>
          </section>
          <section className="bottom-grid"><div className="search-panel panel"><div className="section-title"><span className="section-icon"><Search size={19} /></span><div><h2>Finde deinen Verbrauch</h2><p>Welche {granularity === 'hour' ? 'Stunden' : granularity === 'day' ? 'Tage' : 'Monate'} passen zu deinen Kriterien?</p></div></div><div className="consumption-inputs"><label>Mindestens<input type="number" aria-label="Mindestverbrauch in kWh" placeholder="z. B. 5" min="0" step="0.1" value={minimum} onChange={e => setMinimum(e.target.value)} /><span>kWh</span></label><span>bis</span><label>Höchstens<input type="number" aria-label="Höchstverbrauch in kWh" placeholder="z. B. 15" min="0" step="0.1" value={maximum} onChange={e => setMaximum(e.target.value)} /><span>kWh</span></label></div>{filterError ? <div className="search-result"><p role="alert" className="form-error">Der Mindestverbrauch darf nicht über dem Höchstverbrauch liegen.</p><button onClick={() => { setMinimum(''); setMaximum(''); }}><X size={13} />Zurücksetzen</button></div> : <div className="search-result"><span>{loaded ? <><b>{filteredBuckets.filter(b => b.importEnergy !== null).length}</b> passende Intervalle</> : 'Lade Messwerte, um die Suche zu nutzen.'}</span>{filterActive && <button onClick={() => { setMinimum(''); setMaximum(''); }}><X size={13} />Zurücksetzen</button>}</div>}<p className="small-note">Filtert das Verbrauchsdiagramm, die Intervalltabelle und Verbrauchs-CSV. Kennzahlen beziehen sich auf den gesamten Zeitraum.</p></div>
          <div className="insight-panel panel"><div className="insight-top"><span className="section-icon"><TrendingUp size={20} /></span><span className="mini-label">DEIN VERBRAUCHSMOMENT</span><Sparkles size={16} /></div><h2>{highest ? <>Der höchste Bezug:<br /><span>{formatDate(highest.timestamp, granularity === 'hour' ? { hour: '2-digit', minute: '2-digit' } : { day: '2-digit', month: 'long' })}</span></> : <>Jeder Zeitraum<br />erzählt eine Geschichte.</>}</h2><p>{highest ? <>In diesem Intervall wurden <strong>{formatNumber(highest.importEnergy)} kWh</strong> aus dem Netz bezogen. Wähle „Stündlich“, um genauer hinzusehen.</> : 'Sobald Messwerte vorliegen, siehst du hier das Intervall mit dem höchsten Netzbezug.'}</p><button onClick={() => { navTo('analysis'); setGranularity(duration <= 180 * 86400000 ? 'hour' : 'day'); }}>Genauer ansehen <ArrowUpRight size={16} /></button></div></section>
          {model.warnings.length > 0 && <div className="data-notes"><Info size={16} /><div>{model.warnings.map(w => <p key={w}>{w}</p>)}</div></div>}
          {(view === 'analysis' || filterActive) && <section className="panel interval-panel"><div className="table-heading"><div><h2>Gefundene Intervalle</h2><p>Alle Angaben beziehen sich auf den erfassten Anteil des Intervalls.</p></div><span className="count-badge">{filteredBuckets.length} Ergebnisse</span></div><div className="table-scroll"><table><thead><tr><th>Intervallbeginn</th><th>Netzbezug</th><th>Einspeisung</th><th>Ø Leistung</th><th>Geschätzte Kosten</th></tr></thead><tbody>{filteredBuckets.slice(0, 150).map(row => <tr key={row.timestamp}><td>{formatDate(row.timestamp, { year: 'numeric', hour: '2-digit', minute: '2-digit' })}</td><td>{formatNumber(row.importEnergy)} kWh</td><td>{formatNumber(row.exportEnergy)} kWh</td><td>{formatNumber(row.power, 0)} W</td><td>{formatNumber(row.importEnergy === null ? null : row.importEnergy * settings.tariff)} €</td></tr>)}</tbody></table></div>{filteredBuckets.length > 150 && <p className="small-note table-note">Die ersten 150 Intervalle werden angezeigt. Der CSV-Export enthält alle Treffer.</p>}</section>}
        </>}
        {view === 'data' && <section className="panel data-table-panel"><div className="table-heading"><div><h2>Messwerte durchsuchen</h2><p>Originaldaten deines Zählers, ohne Aggregation.</p></div><label className="table-search"><Search size={16} /><input aria-label="Messwerte durchsuchen" placeholder="Datum, Wert oder ID suchen …" value={query} onChange={e => setQuery(e.target.value)} />{query && <button aria-label="Suche zurücksetzen" onClick={() => setQuery('')}><X size={14} /></button>}</label></div><div className="table-scroll"><table><thead><tr><th><button className="sort-button" onClick={() => setSortAsc(v => !v)}>Zeitpunkt (Berlin)<ChevronDown size={13} style={{ transform: sortAsc ? 'rotate(180deg)' : '' }} /></button></th><th>ID</th><th>Bezugszähler ({settings.counterUnit})</th><th>Einspeisezähler ({settings.counterUnit})</th><th>Leistung ({settings.powerUnit})</th></tr></thead><tbody>{tableRows.slice(page * 50, (page + 1) * 50).map(row => <tr key={row.created_at}><td>{formatDate(Date.parse(row.created_at), { year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })}</td><td className="muted">{row.entry_id}</td><td>{formatNumber(numeric(row[settings.importField]), 3)}</td><td>{formatNumber(numeric(row[settings.exportField]), 3)}</td><td>{formatNumber(numeric(row[settings.powerField]), 1)}</td></tr>)}</tbody></table>{!tableRows.length && <div className="empty-table"><Search size={24} /><h3>{loaded ? 'Keine passenden Messwerte' : 'Noch keine Messwerte geladen'}</h3><p>{loaded ? 'Versuche einen anderen Suchbegriff oder Zeitraum.' : 'Lade deinen Kanal oder wähle „Demo ansehen“.'}</p></div>}</div><div className="pagination"><span>{formatNumber(tableRows.length, 0)} Treffer · 50 pro Seite</span><div><button className="icon-button" aria-label="Vorherige Seite" disabled={page === 0} onClick={() => setPage(p => p - 1)}><ChevronLeft size={17} /></button><span>Seite {page + 1} von {Math.max(1, Math.ceil(tableRows.length / 50))}</span><button className="icon-button" aria-label="Nächste Seite" disabled={(page + 1) * 50 >= tableRows.length} onClick={() => setPage(p => p + 1)}><ChevronRight size={17} /></button></div></div></section>}
        {view === 'settings' && <div className="settings-layout"><section className="panel settings-panel"><div className="section-title"><span className="section-icon"><SlidersHorizontal size={20} /></span><div><h2>Deine Datenquelle</h2><p>Die Einstellungen werden nur in diesem Browser gespeichert.</p></div></div><div className="settings-fields"><label>ThingSpeak-Kanal-ID<input aria-label="ThingSpeak-Kanal-ID" inputMode="numeric" value={settingsDraft.channelId} onChange={e => setSettingsDraft({ ...settingsDraft, channelId: e.target.value })} /><small>Für öffentliche Kanäle wird kein API-Schlüssel benötigt.</small></label><div className="settings-divider" /><h3>Messfelder zuordnen</h3>{([['importField', 'Bezugszähler'], ['exportField', 'Einspeisezähler'], ['powerField', 'Leistung']] as const).map(([key, label]) => <label className="setting-inline" key={key}>{label}<select aria-label={`${label} Messfeld`} value={settingsDraft[key]} onChange={e => setSettingsDraft({ ...settingsDraft, [key]: e.target.value })}>{Array.from({ length: 8 }, (_, i) => <option key={i} value={`field${i + 1}`}>Feld {i + 1}</option>)}</select></label>)}<label className="setting-inline">Einheit der Zählerstände<select aria-label="Einheit der Zählerstände" value={settingsDraft.counterUnit} onChange={e => setSettingsDraft({ ...settingsDraft, counterUnit: e.target.value as Settings['counterUnit'] })}><option value="kWh">kWh</option><option value="Wh">Wh</option></select></label><label className="setting-inline">Einheit der Leistung<select aria-label="Einheit der Leistung" value={settingsDraft.powerUnit} onChange={e => setSettingsDraft({ ...settingsDraft, powerUnit: e.target.value as Settings['powerUnit'] })}><option value="W">Watt (W)</option><option value="kW">Kilowatt (kW)</option></select></label><div className="settings-divider" /><label>Dein Strompreis (€/kWh)<input type="number" aria-label="Strompreis in Euro pro kWh" min="0" max="10" step="0.01" value={settingsDraft.tariff} onChange={e => setSettingsDraft({ ...settingsDraft, tariff: Number(e.target.value) })} /><small>Für eine Kostenschätzung ohne Grundpreis oder Einspeisevergütung.</small></label></div>{formError && <p className="form-error" role="alert">{formError}</p>}<button className="button dark" onClick={saveSettings}>{saved ? <Check size={16} /> : <Check size={16} />}{saved ? 'Gespeichert' : 'Einstellungen speichern'}</button></section><aside className="panel settings-explanation"><span className="section-icon"><CircleHelp size={22} /></span><h2>So wird gerechnet</h2><p><strong>Verbrauch</strong> ist die positive Differenz aufeinanderfolgender kumulierter Zählerstände. Die Voreinstellung nimmt Feld 1 und 2 in kWh, Feld 3 in Watt an. Bitte prüfe die Einheiten deines Zählers.</p><p><strong>Intervallgrenzen</strong> werden linear interpoliert. Fehlt der Randwert, bleibt der Verbrauch unvollständig. Messlücken über zwei Stunden und Zählerrücksetzungen werden ausgelassen und gekennzeichnet.</p><p><strong>Leistung</strong> wird pro Intervall als arithmetischer Mittelwert dargestellt. Tage und Monate folgen der Zeitzone Berlin; Sommer- und Winterzeit werden berücksichtigt.</p><p>Die Website liest ausschließlich Messwerte. Sie verändert keine Daten in ThingSpeak.</p><a href={`https://thingspeak.mathworks.com/channels/${settings.channelId}`} target="_blank" rel="noreferrer">Kanal bei ThingSpeak öffnen <ExternalLink size={14} /></a></aside></div>}
        <footer className="page-footer"><span><Zap size={13} />stromott<span>Ein bisschen mehr Überblick.</span></span><span>{lastLoaded ? `Geladen um ${formatDate(lastLoaded, { hour: '2-digit', minute: '2-digit', day: undefined, month: undefined })} Uhr` : 'Öffentliche Daten von ThingSpeak'}<span className="footer-dot">·</span>Zeitzone Berlin</span></footer>
      </main>
    </div>
  </div>;
}
