import { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import ModalDodajWydatek from '../components/ModalDodajWydatek';
import * as api from '../api';

const MONTH_NAMES = [
  'Styczeń', 'Luty', 'Marzec', 'Kwiecień', 'Maj', 'Czerwiec',
  'Lipiec', 'Sierpień', 'Wrzesień', 'Październik', 'Listopad', 'Grudzień'
];

function getCurrentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export default function ExpensesView({ user }) {
  const [transactions, setTransactions] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [monthStr, setMonthStr] = useState(getCurrentMonth());
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => { loadExpenses(); }, [monthStr]);

  async function loadExpenses() {
    setLoading(true);
    try {
      const catsPromise = api.getCategories(true).catch(() => []);
      const txnsPromise = api.getTransactionsAll().catch(() => []);
      const [catList, txnList] = await Promise.all([catsPromise, txnsPromise]);
      setCategories(catList || []);
      setTransactions(txnList || []);
    } catch {
      setTransactions([]);
    } finally {
      setLoading(false);
    }
  }

  const prevMonth = () => {
    const [y, m] = monthStr.split('-').map(Number);
    const d = new Date(y, m - 2, 1);
    setMonthStr(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  };

  const nextMonth = () => {
    const [y, m] = monthStr.split('-').map(Number);
    let ym = y * 12 + (m - 1) + 1;
    setMonthStr(`${Math.floor(ym / 12)}-${String((ym % 12) + 1).padStart(2, '0')}`);
  };

  const handleAddExpense = async (data) => {
    await api.addTransaction({ ...data });
    loadExpenses();
  };

  const handleDelete = async (id) => {
    if (!confirm('Usunąć tę transakcję?')) return;
    try {
      await api.deleteTransaction(id);
      loadExpenses();
    } catch {}
  };

  const filteredByCategory = selectedCategory === 'all'
    ? transactions
    : transactions.filter(t => t.category_id === Number(selectedCategory));

  const filteredBySearch = filteredByCategory.filter(
    (t) => (t.description || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
           (t.category_name || '').toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Group by category
  const grouped = {};
  for (const tx of filteredBySearch) {
    if (!grouped[tx.category_id]) {
      grouped[tx.category_id] = {
        id: tx.category_id,
        name: tx.category_name || 'Nieznana',
        color: tx.category_color || '#94a3b8',
        icon: tx.category_icon || '',
        transactions: [],
        total: 0,
      };
    }
    grouped[tx.category_id].transactions.push(tx);
    grouped[tx.category_id].total += Number(tx.amount) || 0;
  }

  return (
    <Layout username={user}>
      {/* Month navigation */}
      <div className="flex items-center justify-between mb-6">
        <button onClick={prevMonth} className="px-3 py-1.5 rounded-md bg-white shadow-sm hover:bg-gray-50 dark:bg-slate-800 dark:hover:bg-slate-700 transition-colors" aria-label="poprzedni miesiąc">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
        </button>
       <h2 className="text-lg font-semibold text-gray-800 dark:text-slate-200">
          {MONTH_NAMES[parseInt(monthStr.split('-')[1], 10) - 1]} {monthStr.split('-')[0]}
        </h2>
        <button onClick={nextMonth} className="px-3 py-1.5 rounded-md bg-white dark:bg-slate-800 shadow-sm hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors" aria-label="następny miesiąc">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="w-8 h-8 border-4 border-[#32a852]20 border-t-[#32a852] rounded-full animate-spin" />
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-3 mb-4 items-center">
            <button onClick={() => setModalOpen(true)} className="px-4 py-2 text-sm font-medium text-white bg-[#32a852] hover:bg-[#1f8c42] transition-colors rounded-md flex items-center gap-1.5" aria-label="Dodaj transakcję">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
              Dodaj transakcję
            </button>

            <select value={selectedCategory} onChange={(e) => setSelectedCategory(e.target.value)} className="px-3 py-1.5 rounded-md border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-gray-800 dark:text-slate-200 focus:border-[#32a852] focus:ring-[#32a852] sm:text-sm">
              <option value="all">Wszystkie kategorie</option>
              {categories.map((c) => (
                <option key={c.id} value={`${c.id}`}>{c.name}</option>
              ))}
            </select>

            <input type="text" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} placeholder="Szukaj..." className="flex-1 min-w-[200px] px-3 py-1.5 rounded-md border border-gray-300 focus:border-[#32a852] focus:ring-[#32a852] sm:text-sm" />
          </div>

          <ModalDodajWydatek isOpen={modalOpen} onClose={() => setModalOpen(false)} onSubmit={handleAddExpense} activeCategories={categories} />

          {Object.keys(grouped).length === 0 ? (
            <p className="text-center text-gray-500 py-8">Brak transakcji</p>
          ) : (
            <div className="space-y-4">{Object.values(grouped).map((g) => (
              <div key={g.id} className="bg-white dark:bg-slate-800 rounded-lg shadow-sm overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-200 dark:border-slate-700" style={{ backgroundColor: `${g.color}15` }}>
                  <h3 className="font-medium text-gray-800 dark:text-slate-200 flex items-center gap-2">
                    {g.icon && <span>{g.icon}</span>}
                    {g.name} <span className="text-sm font-normal text-gray-400 dark:text-slate-500">({g.total.toFixed(2)} PLN)</span>
                  </h3>
                </div>

                {g.transactions.map((tx) => (
                  <div key={tx.id} style={{ backgroundColor: `${g.color}0D` }} className="px-4 py-3 flex items-center justify-between hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors border-t border-gray-100 dark:border-slate-700">
                    <span style={{ color: tx.category_color || '#64748b' }} className="flex items-center gap-2 min-w-[140px] shrink-0 max-w-md truncate">
                      {tx.category_icon && <span>{tx.category_icon}</span>}
                      <span className="text-gray-900 font-medium">{tx.description || tx.category_name}</span>
                    </span>

                    <div className="flex items-center gap-3 shrink-0 ml-4">
                      <time className="text-xs text-gray-400 whitespace-nowrap">{tx.date}</time>
                      <span className={`font-semibold whitespace-nowrap ${tx.type === 'Przychód' ? 'text-green-600' : 'text-red-500'}`}>
                        {tx.amount.toFixed(2)} PLN
                      </span>
                      <button onClick={() => handleDelete(tx.id)} className="p-1.5 text-gray-400 hover:text-red-600 transition-colors rounded-md hover:bg-red-50" aria-label="Usuń transakcję">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ))}</div>
          )}
        </>
      )}
    </Layout>
  );
}
