import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import { useToast } from '../components/ToastContext';
import * as api from '../api';

export default function Tags({ user }) {
  const navigate = useNavigate();
  const { success, error: toastError, confirm } = useToast();
  const [transactions, setTransactions] = useState([]);
  const [tags, setTags] = useState([]);
  const [selectedTag, setSelectedTag] = useState(null);
  const [editId, setEditId] = useState(null);
  const [editingName, setEditingName] = useState('');
  const [loading, setLoading] = useState(true);
  const [hasLoaded, setHasLoaded] = useState(false);

  useEffect(() => { loadAll(); }, []);

  async function loadAll() {
    setLoading(true);
    try {
      const txns = await api.getTransactionsAll().catch(() => []);
      setTransactions(txns || []);

      // Collect all unique tags from transactions (stored as JSON array string)
      const tagSet = new Set();
      for (const t of (txns || [])) {
        try {
          if (t.tags && typeof t.tags === 'string') {
            const arr = JSON.parse(t.tags);
            if (Array.isArray(arr)) arr.forEach(tag => tagSet.add(tag));
          } else if (Array.isArray(t.tags)) {
            t.tags.forEach(tag => tagSet.add(tag));
          }
        } catch {}
      }

      // Fetch all unique tags via the backend API
      let fetchedTags = [];
      try {
        fetchedTags = await api.getAllTags();
      } catch {}

      setTags(fetchedTags.length > 0 ? fetchedTags : Array.from(tagSet).sort());
    } finally {
      setLoading(false);
      setHasLoaded(true);
    }
  }

  const getTaggedTransactions = (tag) => {
    return (transactions || []).filter((t) => {
      try {
        let arr = [];
        if (t.tags && typeof t.tags === 'string') {
          arr = JSON.parse(t.tags);
        } else if (Array.isArray(t.tags)) {
          arr = t.tags;
        }
        return Array.isArray(arr) && arr.map(String).some(x => String(x).toLowerCase() === tag.toLowerCase());
      } catch {
        return false;
      }
    });
  };

  // Licznik dla wybranego tagu — wyliczany poza listą, żeby nie zależał od scope'u map().
  const selectedTagCount = selectedTag ? getTaggedTransactions(selectedTag).length : 0;

  const removeTag = async (tagToRemove) => {
    const ok = await confirm(
      `Usunąć tag „${tagToRemove}” ze wszystkich transakcji?`,
      { title: 'Usuń tag', confirmLabel: 'Usuń' }
    );
    if (!ok) return;
    try {
      await api.deleteTag(tagToRemove);
      if (selectedTag === tagToRemove) setSelectedTag(null);
      loadAll();
      success('Tag usunięty');
    } catch (err) { toastError(err.message || 'Nie udało się usunąć tagu'); }
  };

  const startEditing = (tag) => {
    setEditId(tag);
    setEditingName(typeof tag === 'string' ? tag : tag.name);
  };

  const saveTagName = async () => {
    try {
      await api.updateTagName(editId, editingName);
      if (selectedTag === editId) setSelectedTag(editingName);
      loadAll();
      setEditId(null);
      success('Zapisano zmiany');
    } catch (err) { toastError(err.message || 'Nie udało się zmienić nazwy tagu'); }
  };

  const dimmed = loading && hasLoaded;

  return (
    <Layout username={user}>
      <div className="mb-6">
        <h2 className="text-xl font-bold text-gray-900 mb-1 dark:text-slate-100">Tagi</h2>
        <p className="text-sm text-gray-500 dark:text-slate-400">Przeglądaj i zarządzaj transakcjami według tagów (bieżący miesiąc)</p>
      </div>

      {loading && !hasLoaded ? (
        <div className="flex items-center justify-center py-16">
          <div className="w-8 h-8 border-4 border-gray-200 dark:border-slate-700 border-t-[#32a852] rounded-full animate-spin" />
        </div>
      ) : (
        <div className={dimmed ? 'opacity-50 pointer-events-none transition-opacity' : 'transition-opacity'}>
          {tags.length === 0 ? (
            <p className="text-center text-gray-500 dark:text-slate-400 py-8 bg-white dark:bg-slate-800 rounded-lg shadow-sm">Brak tagów w bieżącym miesiącu.</p>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Lewy panel: lista tagów */}
              <div className="lg:col-span-1 space-y-2">
                {tags.map((tag) => {
                  const count = getTaggedTransactions(tag).length;
                  const name = typeof tag === 'string' ? tag : tag.name;
                  return (
                    <button
                      key={typeof tag === 'string' ? tag : tag.id}
                      onClick={() => setSelectedTag(name)}
                      className={`w-full flex items-center justify-between px-4 py-3 rounded-lg shadow-sm hover:shadow-md transition-all text-left ${
                        selectedTag === name
                          ? 'bg-[#32a852]/10 border-l-4 border-[#32a852]'
                          : 'bg-white dark:bg-slate-800 hover:bg-gray-50 dark:hover:bg-slate-700'
                      }`}
                    >
                      <span className="text-sm font-medium text-gray-800 dark:text-slate-200">{name}</span>
                      <div className="flex items-center gap-2">
                        <span className="inline-flex px-2 py-1 text-xs rounded-full bg-[#32a852]/15 text-[#1f8c42] dark:text-[#4ade80]">{count}</span>
                        {typeof tag === 'string' && (
                          <>
                            <button
                              onClick={(e) => { e.stopPropagation(); startEditing(tag); }}
                              className="p-1 text-gray-400 hover:text-[#32a852]"
                              aria-label="Zmień nazwę tagu"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); removeTag(tag); }}
                              className="p-1 text-gray-400 hover:text-red-500"
                              aria-label="Usuń tag"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                            </button>
                          </>
                        )}
                      </div>
                    </button>
                  );
                })}

                {editId && (
                  <div className="bg-white dark:bg-slate-800 rounded-lg shadow-sm p-3">
                    <input
                      autoFocus
                      className="w-full px-2 py-1.5 border border-gray-300 dark:border-slate-600 rounded text-sm bg-white dark:bg-slate-700 text-gray-900 dark:text-slate-100"
                      value={editingName}
                      onChange={(e) => setEditingName(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && saveTagName()}
                    />
                    <div className="flex gap-2 justify-end mt-2">
                      <button onClick={() => setEditId(null)} className="text-xs text-gray-500 dark:text-slate-400 px-2 py-1 rounded hover:bg-gray-100 dark:hover:bg-slate-700">Anuluj</button>
                      <button onClick={saveTagName} className="text-xs text-[#32a852] px-2 py-1 rounded hover:bg-[#32a852]/10 font-medium">Zapisz</button>
                    </div>
                  </div>
                )}
              </div>

              {/* Prawy panel: transakcje z wybranym tagiem */}
              <div className="lg:col-span-2">
                {selectedTag ? (
                  <div className="bg-white dark:bg-slate-800 rounded-lg shadow-sm overflow-hidden">
                    <div className="px-4 py-3 border-b border-gray-200 dark:border-slate-700 bg-[#32a852]/10">
                      <h3 className="font-medium text-gray-800 dark:text-slate-200 flex items-center gap-2">
                        <span className="inline-flex px-2 py-1 text-xs rounded-full bg-[#32a852]/20 text-[#1f8c42] dark:text-[#4ade80]">{selectedTagCount}</span>
                        Oznaczone tagiem: {selectedTag}
                      </h3>
                    </div>

                    {getTaggedTransactions(selectedTag).map((tx) => (
                      <TransactionRow key={tx.id} tx={tx} />
                    ))}
                  </div>
                ) : (
                  <div className="bg-white dark:bg-slate-800 rounded-lg shadow-sm p-6 text-center">
                    <svg className="w-10 h-10 mx-auto mb-3 text-gray-300 dark:text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" /></svg>
                    <p className="text-gray-500 dark:text-slate-400 mb-2">Wybierz tag z lewej, aby zobaczyć przypisane transakcje.</p>
                    <button
                      onClick={() => navigate('/wydatki')}
                      className="inline-flex items-center gap-1 text-sm text-[#32a852] hover:text-[#1f8c42]"
                    >
                      Przejdź do wszystkich wydatków &rarr;
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </Layout>
  );
}

function TransactionRow({ tx }) {
  const navigate = useNavigate();
  const isIncome = (tx.type || '') === 'Przychod';
  return (
    <div className="px-4 py-3 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-slate-700/50 transition-colors border-t border-gray-100 dark:border-slate-700">
      <span className="text-sm text-gray-400 dark:text-slate-500 shrink-0 w-28">{tx.date || tx.transaction_date}</span>

      <div className="flex-1 flex items-center gap-2 min-w-0 ml-3">
        {tx.category_icon && <span>{tx.category_icon}</span>}
        <span className="text-sm font-medium text-gray-700 dark:text-slate-300 truncate">{tx.category_name || 'Nieznana kategoria'}</span>
      </div>

      {tx.description && (
        <span className="flex-1 text-xs text-gray-400 dark:text-slate-500 truncate ml-3 max-w-xs">"{tx.description}"</span>
      )}

      <span className={`font-semibold shrink-0 ${isIncome ? 'text-[#32a852]' : 'text-red-500 dark:text-red-400'} ml-3`}>
        {Math.abs(Number(tx.amount) || 0).toFixed(2)} PLN
      </span>

      <button onClick={() => navigate('/wydatki')} className="ml-3 p-1.5 text-gray-400 hover:text-[#32a852] rounded-md" aria-label="Przejdź do wydatków">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101" /></svg>
      </button>
    </div>
  );
}
