import { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import * as api from '../api';
import AddBudgetModal from '../components/AddBudgetModal';

const MONTH_NAMES = [
  'Styczeń', 'Luty', 'Marzec', 'Kwiecień', 'Maj', 'Czerwiec',
  'Lipiec', 'Sierpień', 'Wrzesień', 'Październik', 'Listopad', 'Grudzień'
];

const getBarStatus = (status, pct) => {
  if ((status === 'over_budget' || status === 'przekroczony') || pct >= 100) return { bg: 'bg-red-500', label: 'Przekroczony', color: 'text-red-600' };
  if (pct >= 80) return { bg: 'bg-amber-500', label: 'Uwaga', color: 'text-amber-600' };
  return { bg: 'bg-gradient-to-r from-[#32a852] to-[#4dd97a]', label: 'OK', color: 'text-[#32a852]' };
};

const getSummaryIcon = (status, pct) => {
  const isOver = (status === 'over_budget' || status === 'przekroczony') || pct >= 100;
  if (isOver) return (
    <div className="w-14 h-14 rounded-xl bg-red-100 flex items-center justify-center">
      <svg className="w-7 h-7 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
    </div>
  );
  return (
    <div className="w-14 h-14 rounded-xl bg-green-100 flex items-center justify-center">
      <svg className="w-7 h-7 text-[#32a852]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
    </div>
  );
};

export default function Budzety({ user }) {
  const [budgets, setBudgets] = useState([]);
  const [loading, setLoading] = useState(true);
  const now = new Date();
  const [monthStr, setMonthStr] = useState(`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`);
  const [showModal, setShowModal] = useState(false);
  const [categories, setCategories] = useState([]);
  const [editingBudgets, setEditingBudgets] = useState({});
  const [originalValues, setOriginalValues] = useState({});
  const [savingId, setSavingId] = useState(null);

  useEffect(() => {
    loadBudgets(monthStr);
  }, [monthStr]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const cats = await api.getCategories(true);
        if (!cancelled) setCategories(cats || []);
      } catch { /* network error */ }
    })();
    return () => { cancelled = true; };
  }, []);

  async function loadBudgets(mStr) {
    setLoading(true);
    try {
      const data = await api.getBudgetsViewByMonth(mStr).catch(() => []) ;
      if (data?.length > 0) {
        const edits = {};
        const orig = {};
        data.forEach(b => { const k = 'cat_' + b.cat_id; edits[k] = Number(b.budzet); orig[k] = Number(b.budzet); });
        setEditingBudgets(edits);
        setOriginalValues(orig);
      } else {
        setEditingBudgets({});
        setOriginalValues({});
      }
      setBudgets(data || [] );
    } finally {
      setLoading(false);
    }
  }

  const prevMonth = () => {
    const parts = monthStr.split('-').map(Number);
    const d = new Date(parts[0], parts[1] - 2, 1);
    setMonthStr(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`);
  };

  const nextMonth = () => {
    const parts = monthStr.split('-').map(Number);
    const d = new Date(parts[0], parts[1], 1);
    setMonthStr(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`);
  };

  const currentMonthIndex = parseInt(monthStr.split('-')[1], 10) - 1;
  const currentYear = monthStr.split('-')[0];

  const totalBudget = budgets.reduce((sum, b) => sum + (Number(b.budzet) || 0), 0);
  const totalSpent = budgets.reduce((sum, b) => sum + (Number(b.wydatki) || 0), 0);
  const overallPct = totalBudget > 0 ? Math.min(100, (totalSpent / totalBudget) * 100) : 0;

  const handleSaveInline = async (budgetId, catKey) => {
     const amt = editingBudgets[catKey];
     if (!amt || amt <= 0) return;
     setSavingId(budgetId);
    try {
      await api.updateBudget(budgetId, { amount_monthly: amt });
      await loadBudgets(monthStr);
    } catch { /* save failed */ } finally {
      setSavingId(null);
    }
  };

  const hasMissingCategory = categories.some(c => !budgets.find(b => b.category_id === c.id));

  return (
    <Layout username={user}>
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="w-8 h-8 border-4 border-green-200 border-t-[#32a852] rounded-full animate-spin" />
        </div>
      ) : (
        <div className="space-y-6">

          {/* Month Navigation */}
          <div className="flex items-center justify-between">
            <button onClick={prevMonth} className="p-2 rounded-lg bg-white shadow-sm hover:bg-gray-50 border border-gray-200 transition-colors" aria-label="Poprzedni miesiac">
              <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
            </button>
            <h2 className="text-xl font-bold text-gray-800">
              {MONTH_NAMES[currentMonthIndex]} {currentYear}
            </h2>
            <button onClick={nextMonth} className="p-2 rounded-lg bg-white shadow-sm hover:bg-gray-50 border border-gray-200 transition-colors" aria-label="Nastepny miesiac">
              <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
            </button>
          </div>

          {/* Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[
              <div key="overall" className="bg-gradient-to-br from-[#32a852] to-[#1f8c42] rounded-xl shadow-lg p-6 text-white relative overflow-hidden">
                <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full -translate-y-8 translate-x-8" />
                {getSummaryIcon(overallPct >= 80 ? 'przekroczony' : 'ok')}
                <div className="relative mt-4">
                  <p className="text-green-100 text-sm font-medium">Całkowity budżet</p>
                  <p className="text-3xl font-bold mt-1">{totalBudget.toFixed(2)} PLN</p>
                </div>
              </div>,
              <div key="spent" className="bg-white rounded-xl shadow-sm p-6 border border-gray-100">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-sm font-medium text-gray-500">Wydane łącznie</p>
                  {overallPct >= 80 ? (
                    <span className="px-2 py-0.5 rounded-full bg-red-100 text-red-600 text-xs font-semibold">Uwaga</span>
                  ) : (
                    <span className="px-2 py-0.5 rounded-full bg-green-100 text-[#32a852] text-xs font-semibold">OK</span>
                  )}
                </div>
                <p className="text-3xl font-bold text-gray-800">{totalSpent.toFixed(2)} PLN</p>
                {totalBudget > 0 && (
                  <p className="text-sm text-gray-400 mt-1">{overallPct.toFixed(1)}% wykorzystane</p>
                )}
              </div>,
              <div key="remaining" className="bg-white rounded-xl shadow-sm p-6 border border-gray-100">
                <p className="text-sm font-medium text-gray-500 mb-3">Pozostało</p>
                {(totalBudget - totalSpent) >= 0 ? (
                  <>
                    <p className="text-3xl font-bold text-[#32a852]">{(totalBudget - totalSpent).toFixed(2)} PLN</p>
                    {totalBudget > 0 && (
                      <div className="mt-2 w-full bg-gray-200 rounded-full h-2">
                        <div style={{ width: `${Math.round(((totalBudget - totalSpent) / totalBudget) * 100)}%` }} className="bg-[#32a852] h-2 rounded-full transition-all duration-500" />
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <p className="text-3xl font-bold text-red-600">-{Math.abs(totalBudget - totalSpent).toFixed(2)} PLN</p>
                    <p className="text-sm text-red-500 mt-1">Przekroczono budżet o {totalSpent.toFixed(2)} PLN</p>
                  </>
                )}
              </div>,
            ]}
          </div>

          {/* Overall Progress */}
          {totalBudget > 0 && (
            <div className="bg-white rounded-xl shadow-sm p-5 border border-gray-100">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-gray-700">Wykorzystanie budżetu</h3>
                <span className={`text-lg font-bold ${overallPct >= 80 ? 'text-red-600' : 'text-[#32a852]'}`}>{overallPct.toFixed(1)}%</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-4 overflow-hidden">
                <div style={{ width: `${Math.min(100, overallPct)}%` }} className={`h-4 rounded-full transition-all duration-700 ${overallPct >= 80 ? 'bg-gradient-to-r from-red-400 to-red-600' : 'bg-gradient-to-r from-[#32a852] to-[#4dd97a]'}`} />
              </div>
            </div>
          )}

          {/* Budget Cards Grid */}
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-bold text-gray-800">Budżety kategorii</h3>
            {hasMissingCategory && (
              <button onClick={() => setShowModal(true)} className="px-4 py-2 rounded-lg text-sm font-semibold bg-[#32a852] hover:bg-[#1f8c42] text-white transition-colors shadow-md flex items-center gap-2">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" /></svg>
                Dodaj budżet
              </button>
            )}
          </div>

          {budgets.length === 0 ? (
            <div className="bg-white rounded-xl shadow-sm p-12 border border-gray-100 text-center">
              <p className="text-gray-500 mb-4">Brak budżetów na ten miesiąc.</p>
              {hasMissingCategory && (
                <button onClick={() => setShowModal(true)} className="px-6 py-3 rounded-lg font-semibold bg-[#32a852] hover:bg-[#1f8c42] text-white transition-colors mx-auto">
                  Dodaj pierwszy budżet
                </button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {budgets.map((bud) => {
                const limit = Number(bud.budzet) || 0;
                const spent = Number(bud.wydatki) || 0;
                const pct = limit > 0 ? Math.min(100, (spent / limit) * 100) : 0;
                const statusInfo = getBarStatus(bud.status, pct);
                const remainder = bud.saldo !== undefined ? bud.saldo : limit - spent;

                return (
                  <div      key={'cat_' + bud.cat_id} className={`bg-white rounded-xl shadow-sm border transition-all hover:shadow-md ${remainder < 0 ? 'border-red-200' : 'border-gray-100'}`}>
                    {/* Header */}
                    <div className="flex items-center gap-3 px-5 py-4 pb-0">
                      {bud.icon ? (
                        <span className="text-2xl">{bud.icon}</span>
                      ) : (
                        <span className={`w-9 h-9 rounded-lg flex items-center justify-center text-white font-bold shrink-0`} style={{ backgroundColor: bud.color || '#94a3b8' }}>
                          {bud.category_name?.charAt(0)?.toUpperCase() || '?'}
                        </span>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-gray-800 truncate">{bud.category_name}</p>
                        <p className={`text-sm font-medium ${statusInfo.color}`}>{statusInfo.label}</p>
                      </div>
                      {limit > 0 && (
                        <span className={`text-base font-bold tabular-nums ${remainder >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                          {remainder >= 0 ? '' : '-'}{Math.abs(remainder).toFixed(2)} PLN
                        </span>
                      )}
                    </div>

                    {/* Progress Bar */}
                    <div className="px-5 py-4 pt-3">
                      {limit > 0 ? (
                        <>
                          <div className="w-full bg-gray-100 rounded-full h-3 overflow-hidden">
                            <div style={{ width: `${pct}%` }} className={`h-3 rounded-full transition-all duration-700 ${statusInfo.bg}`} />
                          </div>
                          <div className="flex justify-between mt-2">
                            <span className="text-xs text-gray-400 font-medium">{spent.toFixed(2)} PLN wydane</span>
                            <span className="text-xs text-gray-400 font-medium">{pct >= 100 ? Math.round(pct) + '%' : pct.toFixed(1) + '%'}</span>
                          </div>
                        </>
                      ) : (
                        <div>
                          <div className="w-full bg-gray-100 rounded-full h-3 overflow-hidden" />
                          <p className="text-xs text-gray-400 mt-2">Brak wydatków</p>
                        </div>
                      )}

                      {/* Inline Budget Edit */}
                      {limit > 0 ? (
                        <div className="flex items-center gap-2 mt-3 pt-3 border-t border-gray-50">
                          <span className="text-xs text-gray-400 font-medium whitespace-nowrap">Budżet:</span>
          <input
                             type="number"
                             min="0.01"
                             step="0.01"
                             value={editingBudgets['cat_' + bud.cat_id] ?? limit}
                             onChange={(e) => setEditingBudgets(prev => ({ ...prev, ['cat_' + bud.cat_id]: parseFloat(e.target.value) || 0 }))}
                            onKeyDown={(e) => { if (e.key === 'Enter') handleSaveInline(bud.id, 'cat_' + bud.cat_id); }}
                                                        className="w-28 px-3 py-1.5 bg-gray-50 border border-gray-200 rounded-lg text-sm font-semibold text-gray-700 outline-none focus:border-[#32a852] focus:ring-1 focus:ring-green-100 transition-all tabular-nums"
                                                      />
                                                      <span className="text-xs text-gray-400">PLN</span>
                               {editingBudgets['cat_' + bud.cat_id] !== originalValues['cat_' + bud.cat_id] && (
                                        <>
                                          <button onClick={() => handleSaveInline(bud.id, 'cat_' + bud.cat_id)} disabled={savingId === bud.id} className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#32a852] hover:bg-[#1f8c42] text-white transition-colors shadow-sm disabled:opacity-50">
                                            {savingId === bud.id ? 'Zapisuję…' : 'Zapisz'}
                                          </button>
                                          <button onClick={() => setEditingBudgets(prev => ({ ...prev, ['cat_' + bud.cat_id]: originalValues['cat_' + bud.cat_id] }))} className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-gray-200 hover:bg-gray-300 text-gray-600 transition-colors">
                                            Anuluj
                                          </button>
            </>
          )}
                        </div>
                      ) : (
                        <button onClick={() => setShowModal(true)} className="mt-3 px-4 py-2 rounded-lg text-xs font-semibold bg-gray-100 hover:bg-gray-200 text-gray-600 transition-colors border border-dashed border-gray-300">
                          Ustaw budżet dla tej kategorii
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Modals */}
          {showModal && (
            <AddBudgetModal
              monthStr={monthStr}
              categories={categories.filter(c => !budgets.find(b => b.category_id === c.id))}
              onClose={() => setShowModal(false)}
              onAdded={() => loadBudgets(monthStr)}
            />
          )}
        </div>
      )}
    </Layout>
  );
}
