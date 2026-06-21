import { useState, useEffect } from 'react';
import * as api from '../api';

export default function AddBudgetModal({ monthStr, categories, onClose, onAdded }) {
  const [selectedCatId, setSelectedCatId] = useState('');
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // when categories load, auto-select if none selected yet
  useEffect(() => {
    if (!selectedCatId && categories.length > 0) {
      setSelectedCatId(categories[0].id?.toString() || '');
    }
  }, [categories, selectedCatId]);

  async function handleSubmit(e) {
    e.preventDefault();
    const amt = parseFloat(amount);
    if (isNaN(amt) || amt <= 0) {
      setError('Kwota musi być większa od 0');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await api.createBudget({
        category_id: parseInt(selectedCatId),
        amount_monthly: amt,
        month_year: monthStr,
      });
      onAdded();
    } catch (err) {
      setError(err.message || 'Nie udało się dodać budżetu');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center" onClick={(e) => e.target === e.currentTarget && onClose()}>
      {/* backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm"></div>

      <div className="relative z-10 w-full max-w-md mx-4 rounded-xl bg-white shadow-2xl border border-gray-100 overflow-hidden">
        {/* header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-gradient-to-r from-[#32a852] to-[#1f8c42] text-white">
          <h3 className="text-lg font-bold">Nowy budżet</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-white/20 transition-colors" aria-label="Zamknij">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {/* category pick */}
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1.5">Kategoria</label>
            {categories.length === 0 ? (
              <p className="text-sm text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">Brak kategorii — najpierw dodaj kategorię na stronie Kategorie.</p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-48 overflow-y-auto border border-gray-200 rounded-lg p-2 bg-white">
                {categories.map((cat) => (
                  <button
                    type="button"
                    key={cat.id}
                    onClick={() => setSelectedCatId(cat.id?.toString() || '')}
                    title={cat.name}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                      selectedCatId === cat.id?.toString()
                        ? 'bg-[#32a852] text-white shadow-md scale-[1.02]'
                        : 'bg-gray-50 text-gray-700 hover:bg-gray-100 border border-transparent'
                    }`}
                  >
                    {cat.icon ? <span className="text-base">{cat.icon}</span> : (
                      <span className="w-4 h-4 rounded-full inline-block shrink-0" style={{ backgroundColor: cat.color || '#94a3b8' }} />
                    )}
                    <span className="truncate">{cat.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* amount */}
          <div>
            <label htmlFor="budgetAmount" className="block text-sm font-medium text-gray-600 mb-1.5">Kwota budżetu (PLN)</label>
            <input
              id="budgetAmount"
              type="number"
              step="0.01"
              min="0"
              value={amount}
              onChange={(e) => { setAmount(e.target.value); setError(null); }}
              placeholder="np. 500.00"
              className={`w-full px-4 py-2.5 bg-gray-50 border rounded-lg text-sm outline-none transition-all ${
                error ? 'border-red-400 focus:ring-2 focus:ring-red-200' : 'border-gray-200 focus:border-[#32a852] focus:ring-2 focus:ring-green-100'
              }`}
            />
          </div>

          {error && (
            <p className="flex items-center gap-2 text-sm font-medium text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
              {error}
            </p>
          )}

          {/* actions */}
          <div className="flex gap-3">
            <button type="button" onClick={onClose} disabled={loading} className="flex-1 px-4 py-2.5 rounded-lg text-sm font-semibold bg-gray-100 hover:bg-gray-200 text-gray-700 transition-colors disabled:opacity-50">Anuluj</button>
            <button type="submit" disabled={loading} className="flex-1 px-4 py-2.5 rounded-lg text-sm font-semibold bg-[#32a852] hover:bg-[#1f8c42] text-white transition-colors shadow-md disabled:opacity-50 disabled:cursor-wait">
              {loading ? 'Dodaję…' : 'Dodaj budżet'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
