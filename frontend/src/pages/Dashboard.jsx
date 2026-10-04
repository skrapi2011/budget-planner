import { useState, useEffect } from 'react';
let darkMQ = typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)') : null;
function useDark() {
  const [dark, setDark] = useState(darkMQ?.matches ?? false);
  useEffect(() => {
    if (!darkMQ) return;
    const handler = (e) => setDark(e.matches);
    darkMQ.addEventListener('change', handler);
    return () => darkMQ.removeEventListener('change', handler);
  }, []);
  return dark || false;
}
import Layout from '../components/Layout';
import AddExpenseModal from '../components/AddExpenseModal';
import * as api from '../api';
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

const MONTH_NAMES = [
  'Styczeń', 'Luty', 'Marzec', 'Kwiecień', 'Maj', 'Czerwiec',
  'Lipiec', 'Sierpień', 'Wrzesień', 'Październik', 'Listopad', 'Grudzień'
];

const GREEN = '#32a852';

function getCurrentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export default function Dashboard({ user }) {
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [monthStr, setMonthStr] = useState(getCurrentMonth());
  const [timeFilter, setTimeFilter] = useState('12m');

  // Data from /api/stats/dashboard-data
  const [dashData, setDashData] = useState(null);
  // Category budget data from /api/budgets/by-month-post
  const [catBudgets, setCatBudgets] = useState([]);
  // Active categories for modal dropdown
  const [activeCategories, setActiveCategories] = useState([]);
  const isDark = useDark();

  useEffect(() => { loadDashboard(); }, [monthStr]);

  async function loadDashboard() {
    setLoading(true);
    try {
      const [data, rawBudgets, catList] = await Promise.all([
        api.getDashboardData(monthStr).catch(() => null),
        api.getBudgetsViewByMonth(monthStr).catch(e => { console.warn('getBudgetsView failed', e); return []; }),
        api.getCategories(true).catch(() => []),
      ]);
      setDashData(data);
      setActiveCategories(catList || []);
      // Map budget response to chart-friendly format
      const budgetsMapped = (rawBudgets || []).map(c => ({
        name: c.category_name,
        color: c.color,
        icon: c.icon,
        budget: Number(c.budzet) || 0,
        expenditure: Number(c.wydatki) || 0,
        balance: Number(c.saldo) || 0,
      }));
      setCatBudgets(budgetsMapped);
    } catch (e) {
      console.error('loadDashboard error', e);
      setDashData(null);
      setActiveCategories([]);
      setCatBudgets([]);
    } finally {
      setLoading(false);
    }
  }

  const handleAddExpense = async (data) => {
    await api.addTransaction(data);
    loadDashboard();
  };

  // Navigation
  const prevMonth = () => setMonthStr(prevMonthFn(monthStr));
  const nextMonth = () => setMonthStr(nextMonthFn(monthStr));

  function prevMonthFn(str) {
    const [y, m] = str.split('-').map(Number);
    const d = new Date(y, m - 2, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  function nextMonthFn(str) {
    const [y, m] = str.split('-').map(Number);
    let ym = y * 12 + (m - 1) + 1;
    return `${Math.floor(ym / 12)}-${String((ym % 12) + 1).padStart(2, '0')}`;
  }

  // Bar chart data filtering
  const getBarChartData = () => {
    if (!dashData || !dashData.monthly_history || dashData.monthly_history.length === 0) return [];
    const map = { '3m': 3, '6m': 6, '12m': 12, 'all': 999 };
    const count = map[timeFilter] || 12;
    return dashData.monthly_history.slice(-count);
  };

  if (loading || !dashData) {
    return <Layout username={user}><div className="flex items-center justify-center py-24"><div className="w-10 h-10 border-4 border-gray-200 border-t-[#32a852] rounded-full animate-spin" /></div></Layout>;
  }

  const { total_all_time = 0, prev_month_total = 0, month_total = 0, planned_all_time = 0, current_planned = 0, chart_data = [], monthly_history = [] } = dashData;

  function getPrevMonthLabel() {
    const [y, m] = monthStr.split('-').map(Number);
    if (m === 1) return `${MONTH_NAMES[11]} ${y - 1}`;
    return MONTH_NAMES[m - 2];
  }

  function getChangePct(current, previous) {
    if ((previous ?? 0) === 0) return current > 0 ? null : 0;
    const diff = ((current - previous) / previous) * 100;
    return Math.round(diff);
  }

  const changePct = getChangePct(month_total, prev_month_total);

  return (
    <Layout username={user}>
      {/* Month Navigation */}
      <div className="flex items-center justify-between mb-8">
        <button onClick={prevMonth} className="p-2 rounded-lg bg-white dark:bg-slate-800 shadow-sm hover:bg-gray-50 dark:hover:slate-700 transition-colors text-gray-600 dark:text-slate-300 border border-gray-200 dark:border-slate-700">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
        </button>
        <h2 className="text-xl font-bold text-gray-800 dark:text-slate-200">
          {MONTH_NAMES[parseInt(monthStr.split('-')[1], 10) - 1]} {monthStr.split('-')[0]}
        </h2>
       <button onClick={nextMonth} className="p-2 rounded-lg bg-white dark:bg-slate-800 shadow-sm hover:bg-gray-50 dark:hover:slate-700 transition-colors text-gray-600 dark:text-slate-300 border border-gray-200 dark:border-slate-700">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
        </button>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <StatCard label="Budżet miesięczny" value={current_planned} icon={<IconCurrent />} color="#8b5cf6" />
        <StatCard label="Wydatki w tym miesiącu" value={month_total} icon={<IconMonth />} color="#3b82f6" />
        <StatCard2 label="Zmiana wydatków" change={changePct} absDiff={month_total - prev_month_total} monthStr={monthStr} icon={<IconChange />} color={changePct !== null ? (changePct > 0 ? '#ef4444' : '#32a852') : 'var(--tw-text-muted)'} />
        <StatCard label="Wydatki całość" value={total_all_time} icon={<IconAllTime />} color="#ef4444" />
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        {/* Donut Chart */}
        <Card title="Struktura wydatków według kategorii">
          {(() => {
            const monthCat = catBudgets.filter(c => (Number(c.expenditure) || 0) > 0);
            if (monthCat.length === 0) return <p className="text-center text-gray-400 dark:text-slate-500 py-12">Brak danych. Dodaj transakcje aby zobaczyć wykres.</p>;

            const sorted = [...monthCat].sort((a, b) => (b.expenditure || 0) - (a.expenditure || 0));
            const monthTotal = monthCat.reduce((s, c) => s + (Number(c.expenditure)||0), 0);

            return (
              <div className="flex items-center gap-6">
                {/* Category list on the left */}
<div 
                  style={{ 
                    maxHeight: '260px', 
                    minWidth: '160px', 
                    overflowY: 'auto'
                  }}
                   className="no-scrollbar space-y-2 shrink-0 rounded-xl border border-gray-300 dark:border-slate-600 p-4"
                >
{sorted.map((item) => (
                    <div key={item.name} className="flex items-center gap-2 py-1">
                      <span style={{ backgroundColor: item.color || '#94a3b8' }} className="w-3 h-3 rounded-full shrink-0" />
                      <div className="flex flex-col">
                        <span className="text-sm font-medium text-gray-700 dark:text-slate-200">{item.name}</span>
                        <span className="text-xs text-gray-400 dark:text-slate-500">{formatMoney(item.expenditure)}</span>
                      </div>
                    </div>
                  ))}
                </div>
                {/* Pie chart on the right */}
                <div className="relative shrink-0">
                  <ResponsiveContainer width={280} height={260}>
                    <PieChart>
                      <Pie
                        data={sorted.map(c => ({ name: c.name, value: Number(c.expenditure) || 0, color: c.color }))}
                        cx="50%"
                        cy="50%"
                        outerRadius="85%"
                        innerRadius="75%"
                        paddingAngle={2.5}
                        cornerRadius={3}
                        dataKey="value"
                        nameKey="name"
                        stroke="none"
                      >
                        {sorted.map((entry, i) => (
                          <Cell key={`cell-${i}`} fill={entry.color || '#94a3b8'} />
                        ))}
                      </Pie>
                      <Tooltip content={<CustomTooltip />} />
                    </PieChart>
                  </ResponsiveContainer>
                  {/* Sum in center */}
                  <div className="absolute flex items-center justify-center" style={{ width: 90, height: 90, left: "50%", top: "50%", marginLeft: -45, marginTop: -45 }}>
                    <div style={{ textAlign: 'center' }}>
                        <p className="text-xs text-gray-500 dark:text-slate-400 mb-1">Suma</p>
                      <p className="text-lg font-bold" style={{ color: GREEN }}>{formatMoney(monthTotal)}</p>
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}
        </Card>

        {/* Bar Chart */}
        <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm p-5 hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-bold text-gray-800 dark:text-slate-200">Wydatki w czasie</h3>
            <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500 dark:text-slate-400 whitespace-nowrap">Suma: {formatMoney(getBarChartData().reduce((s,d)=>s+(d.actual||0), 0))}</span>
              {['3m', '6m', '12m', 'all'].map((opt) => (
                <button
                  key={opt}
                  onClick={() => setTimeFilter(opt)}
                  className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors ${timeFilter === opt ? 'bg-[#32a852] text-white' : 'bg-gray-200 dark:bg-slate-700 text-gray-600 dark:text-slate-300 hover:bg-gray-300 dark:hover:bg-slate-600'}`}
                >
                  {opt}
                </button>
              ))}
            </div>
          </div>

          {!monthly_history || monthly_history.length === 0 ? (
           <p className="text-center text-gray-400 dark:text-slate-500 py-12">Brak danych miesięcznych.</p>
          ) : (
            <ResponsiveContainer width={550} height={340}>
              <BarChart data={getBarChartData()} margin={{ top: 10, right: 20, left: 10, bottom: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                {timeFilter === '3m' || timeFilter === '6m' ? (
                  <XAxis dataKey="label" tick={{fontSize:12}} angle={-45} textAnchor="end" height={80}/>
                ) : (
                  <XAxis dataKey="label" tick={{fontSize:12, fill:'#6b7280'}} interval={1} />
                )}
                <YAxis tick={{ fontSize: 12 }} width={60}/>
                <Tooltip formatter={(value) => [formatMoney(value), null]} content={<CustomBarTooltip />} />
                <Legend iconType="circle" wrapperStyle={{ fontSize: '13px' }}/>
                <Bar dataKey="actual" name={timeFilter === 'all' ? 'Rzeczywiste (wszystkie)' : `Rzeczywiste (${timeFilter})`} fill={GREEN} radius={[6, 6, 0, 0]} barSize={20} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Category Budget Progress */}
      <Card title="Budżet kategorii">
        {catBudgets.length === 0 ? (
        <p className="text-center text-gray-400 dark:text-slate-500 py-8">Brak danych budżetowych dla tego miesiąca.</p>
        ) : (
          <div className="space-y-4 max-h-[500px] overflow-y-auto pr-2 custom-scrollbar">
            {catBudgets.map((c, idx) => (
              <CategoryRow key={idx} cat={c} isDark={isDark} />
            ))}
          </div>
        )}
      </Card>

      <AddExpenseModal isOpen={modalOpen} onClose={() => setModalOpen(false)} onSubmit={handleAddExpense} activeCategories={activeCategories} />


      {/* Floating add button */}
      <button
        onClick={() => setModalOpen(true)}
        className="fixed bottom-6 right-6 w-14 h-14 flex items-center justify-center rounded-full shadow-lg text-white hover:scale-110 transition-transform"
        style={{ backgroundColor: GREEN }}
        aria-label="Dodaj wydatek"
      >
        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
      </button>
    </Layout>
  );
}

function Card({ title, children }) {
  return (
   <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm p-5 hover:shadow-md transition-shadow">
      <h3 className={`text-base font-bold mb-4 text-gray-800 dark:text-slate-200`}>{title}</h3>
      {children}
    </div>
  );
}

function StatCard({ label, value, icon, color, badge }) {
  return (
     <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm hover:shadow-md transition-shadow p-5 relative overflow-hidden">
       {badge && <span className="absolute top-3 right-4 text-xs font-medium bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-slate-300 px-2 py-0.5 rounded-full">{badge}</span>}
       <div className="flex items-center gap-3 mb-3">
         <div style={{ backgroundColor: color + '20' }} className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0">
           {icon}
         </div>
         <span className="text-sm font-medium text-gray-600 dark:text-slate-400">{label}</span>
       </div>

       <p className={`text-2xl font-bold`} style={{ color }}>{formatMoney(value)}</p>
     </div>
   );
 }


function StatCard2({ label, change, absDiff: propAbsDiff, monthStr: ms, icon, color: arrowColor }) {
  const [prevLabel, setPrevLabel] = useState('');

  useEffect(() => {
    if (!ms) return;
    const [y, m] = ms.split('-').map(Number);
    let py, pm;
    if (m === 1) { py = y - 1; pm = 12; } else { py = y; pm = m - 1; }
    setPrevLabel(`${MONTH_NAMES[pm - 1]} ${py}`);
 }, [ms]);

  const absDiffRaw = Number(propAbsDiff) || 0;
  const sign = absDiffRaw >= 0 ? '+' : '';

  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm hover:shadow-md transition-shadow p-5 relative overflow-hidden">
      <div className="flex items-center gap-3 mb-1">
        <div style={{ backgroundColor: arrowColor + '20' }} className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0">
          {icon}
        </div>
        <span className="text-sm font-medium text-gray-600 dark:text-slate-400">{label}</span>
      </div>

      <p className="text-xs text-gray-500 dark:text-slate-400 mb-2">
        {ms ? MONTH_NAMES[parseInt(ms.split('-')[1], 10) - 1] : ''} vs {prevLabel || '—'}
      </p>

      <div className="flex items-baseline gap-3 flex-wrap">
        <p className={`text-xl font-bold`} style={{ color: arrowColor }}>
          {change !== null && change > 0 ? `↑ ${Math.abs(change)}%` : (change !== null ? `↓ ${Math.abs(change)}%` : '—')}
        </p>
        <p className={`text-lg font-bold`} style={{ color: arrowColor }}>
          {sign}{formatMoney(absDiffRaw)}
        </p>
      </div>

      <p className="text-xs text-gray-400 dark:text-slate-500 mt-1">
        {change === null && 'Brak danych za poprzedni miesiąc'}
      </p>
   </div>
  );
 }

function CategoryRow({ cat, isDark }) {
  const wydatki = cat.expenditure || 0;
  const budzet = cat.budget || 0;
  
  const balance = cat.balance !== undefined ? cat.balance : (budzet - wydatki);

  const rawPct = budzet > 0 
    ? Math.max(5, (wydatki / budzet) * 100) 
    : (wydatki > 0 ? 5 : 0);

  return (
    <div className="border-b border-gray-100 dark:border-slate-700 pb-3">
      <div className="flex items-center justify-between mb-2" style={{ flexWrap: 'wrap', gap: '8px' }}>
        <div className="flex items-center gap-3">
          <span style={{ backgroundColor: cat.color || '#94a3b8' }} className="w-4 h-4 rounded-full shrink-0 shadow-sm border border-gray-100 dark:border-slate-600" />
          <span className="font-medium text-gray-800 dark:text-slate-200">{cat.name}</span>
        </div>
        <div className="text-right">
          {budzet > 0 && (
            <p className={`text-xs ${isDark ? 'text-slate-400' : 'text-gray-500'}`}>{wydatki.toFixed(2)} / {budzet} zł</p>
          )}
          <span style={{ color: balance >= 0 ? GREEN : '#dc2626' }} className="text-sm font-bold">
            {(balance > 0 ? '+' : '')}{formatMoney(balance)}
          </span>
        </div>
      </div>

      {budzet > 0 && (
        <div className="w-full h-3 bg-gray-200 dark:bg-slate-700 rounded-full overflow-hidden relative"> 
           {/* 'overflow-hidden' na rodzicu sprawia, że pasek szerokości >100% po prostu zniknie za krawędzią */}
          <div
            style={{ 
              width: `${rawPct}%`,
              backgroundColor: wydatki > budzet ? '#ef4444' : (cat.color || '#3b82f6') 
            }}
            className="h-full rounded-full transition-all duration-700"
          />
        </div>
      )}
    </div>
  );
}

// Reusable icon components for stat cards
function IconAllTime() { return <svg className="w-5 h-5 text-[#ef4444]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" /></svg>; }
function IconMonth() { return <svg className="w-5 h-5 text-[#3b82f6]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 000-4H5a2 2 0 000 4z" /></svg>; }
function IconCurrent() { return <svg className="w-5 h-5 text-[#8b5cf6]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 8c-3.866 0-7 1.567-7 3.5V14a2 2 0 002 2h2v-2.5m14 0H9" /></svg>; }
function IconChange() { return <svg className="w-5 h-5 text-[#f59e0b]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" /></svg>; }

function formatMoney(v) {
  v = Number(v || 0);
  return `${v.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} zł`;
}

function CustomTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white dark:bg-slate-800 border dark:border-slate-700 shadow-md p-3 rounded-lg">
      {payload.map((p) => {
        const val = Number(p.value).toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        return (
          <div key={p.name} style={{ display:'flex', alignItems:'center', gap:'6px', margin:'4px 0' }}>
            <span style={{ width:'10px', height:'10px', borderRadius:'50%', background:p.color, flexShrink:0 }} />
            <span className="text-gray-900 dark:text-slate-100">{p.name}: {val} zł</span>
          </div>
        );
      })}
    </div>
  );
}

function CustomBarTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  const seenNames = new Set();
  return (
     <div className="bg-white dark:bg-slate-800 border dark:border-slate-700 shadow-md p-3 rounded-lg max-w-[240px]">
      {d.label && <p className="text-gray-900 dark:text-white" style={{ fontSize:'13px', fontWeight:700, marginBottom:'6px' }}>{d.label}</p>}
      {payload.map((e) => {
        const val = Number(e.value).toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        if (seenNames.has(e.name)) return null;
        seenNames.add(e.name);
        return (
          <div key={e.name} style={{ display:'flex', alignItems:'center', gap:'6px', margin:'4px 0' }}>
            <span style={{ width:'10px', height:'10px', borderRadius:'50%', background:e.color, flexShrink:0 }} />
            <span className="text-gray-600 dark:text-slate-400" style={{ fontSize:'13px' }}>{e.name}</span>
            <strong className="text-gray-900 dark:text-white">{val} zł</strong>
          </div>
        );
      })}
    </div>
  );
}
