import { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import * as api from '../api';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';

const GREEN = '#32a852';
const BLUE_LINE = 'rgba(59, 130, 246, 0.6)';

function getCurrentYear() {
  return new Date().getFullYear();
}

export default function YearOverview({ user }) {
  const [loading, setLoading] = useState(true);
  const [year, setYear] = useState(getCurrentYear());
  const [data, setData] = useState(null);

  async function loadYear() {
    setLoading(true);
    try {
      const res = await api.getYearSummary(String(year));
      setData(res || null);
    } catch (e) {
      console.error('load year data error', e);
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadYear(); }, [year]);

  function prevYear() { setYear(y => y - 1); }
  function nextYear() { setYear(y => y + 1); }

  if (loading || !data) {
    return (
      <Layout username={user}>
        <div className="flex items-center justify-center py-24">
          <div className="w-10 h-10 border-4 border-gray-200 border-t-[#32a852] rounded-full animate-spin" />
        </div>
      </Layout>
    );
  }

  const { total_spending, total_budgeted, variance, avg_monthly_spending, avg_monthly_budgeted, spend_rate, monthly_summary: rawMonthlySummary = [], category_variance } = data;

  // Backend already truncates the current year to elapsed months and returns
  // all 12 months for past years - no client-side filtering needed.
  const monthly_summary = (rawMonthlySummary || []).filter(m => m?.month);

  const pctUsed = total_budgeted > 0 ? (total_spending / total_budgeted) * 100 : 0;

  const chartData = monthly_summary.map(m => ({
    label: m.label,
    spending: m.spending,
    budget: m.budget > 0 ? m.budget : null,
  }));

  return (
    <Layout username={user}>
      {/* Year Navigation */}
      <div className="flex items-center justify-between mb-8">
        <button onClick={prevYear} className="p-2 rounded-lg bg-white dark:bg-slate-800 shadow-sm hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors text-gray-600 dark:text-slate-300 border border-gray-200 dark:border-slate-700">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
        </button>
        <h2 className="text-xl font-bold text-gray-800 dark:text-slate-200">Roczny Przegląd - {year}</h2>
        <button onClick={nextYear} className="p-2 rounded-lg bg-white dark:bg-slate-800 shadow-sm hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors text-gray-600 dark:text-slate-300 border border-gray-200 dark:border-slate-700">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
        <SummaryCard label="Roczne wydatki" value={total_spending} color="#ef4444" />
        <SummaryCard label="Roczny budżet" value={total_budgeted} color="#f59e0b" />
        <SummaryCard label="Saldo roczne" value={variance} color={variance >= 0 ? GREEN : '#ef4444'} />
        <SummaryCard label="Wykorzystanie budżetu" value={spend_rate != null ? `${spend_rate}%` : 'N/A'} />
        <SummaryCard label="Średnie miesięczne wydatki" value={avg_monthly_spending} color="#3b82f6" />
        <SummaryCard label="Średni budżet miesięczny" value={avg_monthly_budgeted} color="#8b5cf6" />
      </div>

      {/* Bar chart + category variance */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm p-5 hover:shadow-md transition-shadow">
          <h3 className="text-base font-bold mb-4 text-gray-800 dark:text-slate-200">Wydatki w roku {year}</h3>
          {!monthly_summary || monthly_summary.length === 0 ? (
            <p className="text-center text-gray-400 dark:text-slate-500 py-12">Brak danych. Dodaj transakcje aby zobaczyć wykres.</p>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={chartData} margin={{ top: 10, right: 20, left: 10, bottom: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" className="dark:stroke-slate-600" />
                <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} width={60}/>
                <Tooltip content={<CustomBarTooltip />} />
                <Legend iconType="circle" wrapperStyle={{ fontSize: '13px' }}/>
                <Line dataKey="spending" name="Wydatki" stroke={GREEN} strokeWidth={4} dot={{ r: 6, fill: '#fff', strokeWidth: 2, stroke: GREEN }} connectNulls />
                <Line type="monotone" dataKey="budget" name="Budżet" stroke={BLUE_LINE} strokeWidth={1.5} strokeDasharray="8 3" dot={false} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

         {/* Progress overview */}
        <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm p-5 hover:shadow-md transition-shadow">
          <h3 className="text-base font-bold mb-4 text-gray-800 dark:text-slate-200">Podsumowanie roku</h3>

          {/* Total budget bar */}
          <div>
            {(() => {
              const noBudget = total_budgeted <= 0;
              return (
                <>
                  <h4 className="text-sm font-semibold text-gray-700 dark:text-slate-300 mb-2">Saldo budżetu rocznego</h4>

                   {!noBudget && variance > 0 ? (
                    <div className="flex items-end justify-between mb-1">
                      <p className={`text-lg font-bold ${variance >= 0 ? 'text-[#32a852]' : 'text-red-600'}`}>
                        {formatMoney(Math.abs(variance))}
                      </p>
                      <div className="flex flex-col items-end">
                        <span className="text-xs font-bold text-gray-700 dark:text-slate-300">{((variance / total_budgeted) * 100).toFixed(1)}%</span>
                        <span className="text-[10px] font-medium text-[#32a852] dark:text-green-400">Zaoszczędzone</span>
                      </div>
                    </div>
                  ) : !noBudget && variance <= 0 ? (
                    <div className="flex items-end justify-between mb-1">
                      <p className={`text-lg font-bold ${variance >= 0 ? 'text-[#32a852]' : 'text-red-600'}`}>
                        {formatMoney(Math.abs(variance))}
                      </p>
                      <div className="flex flex-col items-end">
                        <span className="text-xs font-bold text-gray-700 dark:text-slate-300">{((variance / total_budgeted) * 100).toFixed(1)}%</span>
                        <span className="text-[10px] font-medium text-red-600 dark:text-red-400">Przekroczenie</span>
                      </div>
                    </div>
                  ) : (
                    <>
                      <p className={`text-lg font-bold ${variance >= 0 ? 'text-[#32a852]' : 'text-red-600'}`}>
                        {formatMoney(Math.abs(variance))}
                      </p>
                      {total_spending > 0 && (
                        <p className="text-xs text-gray-500 dark:text-slate-500 mt-1">Nie ustawiono żadnych budżetów na ten rok</p>
                      )}
                    </>
                  )}

                  {noBudget ? null : total_spending > 0 ? (
                    <>
                      <div className="w-full h-4 bg-gray-200 dark:bg-slate-700 rounded-full overflow-hidden mt-1.5 mb-1">
                        <div
                          className="h-full transition-all duration-500 rounded-full"
                          style={{ width: `${Math.min(100, pctUsed)}%`, backgroundColor: variance >= 0 ? GREEN : '#ef4444' }}
                        />
                      </div>
                      <p className="text-right text-xs text-gray-400 dark:text-slate-500">
                        {formatMoney(total_spending)} / {formatMoney(total_budgeted)} ({pctUsed.toFixed(1)}%)
                      </p>
                    </>
                  ) : total_spending > 0 ? (
                    <p className="text-xs text-gray-400 dark:text-slate-600 mt-1">Brak danych</p>
                  ) : null}
                </>
              );
            })()}
          </div>

          {/* Category variance table */}
          <div>
            <h4 className="text-sm font-semibold text-gray-700 dark:text-slate-300 mb-2">Odchylenia wg kategorii</h4>
            {!category_variance || category_variance.length === 0 ? (
              <p className="text-center text-gray-400 dark:text-slate-500 py-6">Brak danych.</p>
            ) : (() => {
              const maxRatio = Math.max(...category_variance.map(cv=>cv.budget > 0 ? cv.spending/cv.budget : (cv.spending > 0 ? 2 : 0)));
              const scaleMax = Math.min(maxRatio * 1.25, 2);
              return (
                <div style={{ maxHeight: '180px', overflowY: 'auto' }}>
                  {category_variance.map((cv, idx) => {
                    const ratio = cv.budget > 0 ? (cv.spending / cv.budget) : (cv.spending > 0 ? scaleMax*0.9 : 0);
                    const barPct = Math.max(5, (ratio / scaleMax) * 100);
                    return (
                      <div key={idx} className="mb-3 last:mb-0">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-sm text-gray-700 dark:text-slate-300">{cv.name}</span>
                          {cv.budget > 0 && cv.spending > 0 && (
                            <span className="text-xs font-semibold text-gray-400 dark:text-slate-500">
                              {((cv.spending / cv.budget) * 100).toFixed(0)}% budżetu
                            </span>
                          )}
                          {cv.budget > 0 && (
                            <div className="flex items-center gap-2 text-xs">
                              <span className={`font-medium ${(cv.variance >= 0 ? 'text-green-600' : 'text-red-600')}`}>
                                {formatMoney(cv.variance)}
                              </span>
                              <span className="text-gray-400 dark:text-slate-500">{formatMoney(cv.spending)}</span>
                            </div>
                          )}
                        </div>
                        <div className="w-full h-2 bg-gray-200 dark:bg-slate-700 rounded-full overflow-hidden">
                          <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.min(100, barPct)}%`, backgroundColor: cv.variance >= 0 ? GREEN : '#ef4444' }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </div>
        </div>
      </div>

      {/* Monthly Summary Table */}
      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm p-5 hover:shadow-md transition-shadow">
        <h3 className="text-base font-bold mb-4 text-gray-800 dark:text-slate-200">Miesięczne porównanie</h3>
        {!monthly_summary || monthly_summary.length === 0 ? (
          <p className="text-center text-gray-400 dark:text-blue-slate-500 py-8">Brak danych.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-slate-700">
                  <th className="text-left py-3 px-4 font-semibold text-gray-700 dark:text-slate-300">Miesiąc</th>
                  <th className="text-right py-3 px-4 font-semibold text-gray-700 dark:text-slate-300">Budżet</th>
                  <th className="text-right py-3 px-4 font-semibold text-gray-700 dark:text-slate-300">Wydatek</th>
                  <th className="text-right py-3 px-4 font-semibold text-gray-700 dark:text-slate-300">Saldo</th>
                  <th className="text-center py-3 px-4 font-semibold text-gray-700 dark:text-slate-300">Status</th>
                </tr>
              </thead>
              <tbody>
                {monthly_summary.map((m, idx) => (
                  <tr key={idx} className="border-b border-gray-100 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-700/50 transition-colors">
                    <td className="py-3 px-4 font-medium text-gray-800 dark:text-slate-200">{m.label}</td>
                    <td className={`py-3 px-4 text-right ${m.budget === 0 ? 'text-gray-400 dark:text-slate-600' : 'text-gray-600 dark:text-slate-400'}`}>
                      {formatMoney(m.budget)}
                    </td>
                    <td className="py-3 px-4 text-right font-medium text-red-600 dark:text-red-400">{formatMoney(m.spending)}</td>
                    <td className={`py-3 px-4 text-right font-bold ${m.balance >= 0 ? 'text-green-600' : 'text-red-600'}`}>{formatMoney(m.balance)}</td>
                    <td className="py-3 px-4 text-center">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${m.on_budget ? (variance >= 0 ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400' : 'bg-gray-100 dark:bg-slate-700 text-gray-500 dark:text-slate-400') : 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'}`}>
                        {m.on_budget ? 'OK' : 'Nadbudżet'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

    </Layout>
  );
}

function SummaryCard({ label, value, color = GREEN }) {
  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm hover:shadow-md transition-shadow p-5 relative overflow-hidden">
      <p className="text-sm font-medium text-gray-600 dark:text-slate-400 mb-2">{label}</p>
      <p className={`text-2xl font-bold`} style={{ color }}>
        {typeof value === 'string' && value.endsWith('%') ? value : typeof value !== 'string' && (value == null || isNaN(parseFloat(value))) ? String(value) : formatMoney(value)}
      </p>
    </div>
  );
}

function formatMoney(v) {
  if (typeof v === 'string' && v.endsWith('zł')) return v;
  const num = Number(v);
  if (isNaN(num)) return String(v);
  return `${num.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} zł`;
}

function CustomBarTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-white dark:bg-slate-800 border dark:border-slate-700 shadow-md p-3 rounded-lg max-w-[240px]">
      {d.label && <p style={{ fontSize:'13px', fontWeight:700, marginBottom:'6px' }} className="text-gray-900 dark:text-white">{d.label}</p>}
      {payload.filter(e => e.value != null).map((e) => {
        const val = Number(e.value).toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        return (
          <div key={e.name} style={{ display:'flex', alignItems:'center' }}>
            <span style={{ width:'10px', height:'10px', borderRadius:'50%', background:e.color, flexShrink:0 }} />
            <span className="text-gray-600 dark:text-slate-400 text-xs mx-2">{e.name}</span>
            <strong className="text-gray-900 dark:text-white">{val} zł</strong>
          </div>
        );
      })}
    </div>
  );
}
