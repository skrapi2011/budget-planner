import { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import * as api from '../api';

export default function Tags({ user }) {
  const [transactions, setTransactions] = useState([]);
  const [tags, setTags] = useState([]);
  const [selectedTag, setSelectedTag] = useState(null);
  const [newTagInput, setNewTagInput] = useState('');
  const [editId, setEditId] = useState(null);
  const [editingName, setEditingName] = useState('');
  const [loading, setLoading] = useState(true);

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

  const handleAddTagToTransaction = async (txId, tagText) => {
    if (!tagText.trim()) return;
    try {
      await api.updateTransactionTags(txId, [...(transactions.find(t => t.id === txId)?.tags || []), tagText.trim()]);
      loadAll();
    } catch (err) {
      alert(err.message);
    }
  };

  const removeTag = async (tagToRemove) => {
    if (!confirm('Remove this tag from all transactions?')) return;
    try {
      await api.deleteTag(tagToRemove);
      loadAll();
    } catch {}
  };

  const startEditing = (tag) => {
    setEditId(tag);
    setEditingName(typeof tag === 'string' ? tag : tag.name);
  };

  const saveTagName = async () => {
    try {
      await api.updateTagName(editId, editingName);
      loadAll();
      setEditId(null);
    } catch {}
  };

  return (
    <Layout username={user}>
      <div className="mb-6">
        <h2 className="text-xl font-bold text-gray-900 mb-1">Tag Management</h2>
        <p className="text-sm text-gray-500">Manage and filter transactions by tags</p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="w-8 h-8 border-4 border-blue-200 border-t-blue-500 rounded-full animate-spin" />
        </div>
      ) : (
        <>
          {/* New tag input */}
          <div className="mb-6">
            <h3 className="text-sm font-semibold text-gray-700 mb-2">Quick Add Tag</h3>
            <p className="text-xs text-gray-500 mb-2">Add a tag to any transaction on the right side. Tags are collected from all transactions.</p>
          </div>

          {tags.length === 0 ? (
            <p className="text-center text-gray-500 py-8 bg-white rounded-lg shadow-sm">No tags found. Add tags via the tag input on individual transactions.</p>
          ) : (
            <>
              {/* Left panel: tag list */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-1 space-y-2">
                  {tags.map((tag) => {
                    const count = getTaggedTransactions(tag).length;
                    return (
                      <button
                        key={typeof tag === 'string' ? tag : tag.id}
                        onClick={() => {
                          setSelectedTag(typeof tag === 'string' ? tag : tag.name);
                        }}
                        className={`w-full flex items-center justify-between px-4 py-3 rounded-lg shadow-sm hover:shadow-md transition-all text-left ${
                          selectedTag === (typeof tag === 'string' ? tag : tag.name)
                            ? 'bg-blue-50 border-l-4 border-blue-500'
                            : 'bg-white hover:bg-gray-50'
                        }`}
                      >
                        <span className="text-sm text-gray-800 font-medium">{typeof tag === 'string' ? tag : tag.name}</span>
                        <div className="flex items-center gap-2">
                          <span className="inline-flex px-2 py-1 text-xs rounded-full bg-blue-100 text-blue-700">{count}</span>
                          {typeof tag === 'string' && (
                            <>
                              <button
                                onClick={(e) => { e.stopPropagation(); startEditing(tag); }}
                                className="p-1 text-gray-400 hover:text-blue-500"
                              >
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                              </button>
                              <button
                                onClick={(e) => { e.stopPropagation(); removeTag(tag); }}
                                className="p-1 text-gray-400 hover:text-red-500"
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
                    <div className="bg-white rounded-lg shadow-sm p-3">
                      <input
                        className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                        value={editingName}
                        onChange={(e) => setEditingName(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && saveTagName()}
                      />
                      <div className="flex gap-2 justify-end mt-2">
                        <button onClick={() => setEditId(null)} className="text-xs text-gray-500 px-2 py-1 rounded hover:bg-gray-100">Cancel</button>
                        <button onClick={saveTagName} className="text-xs text-blue-600 px-2 py-1 rounded hover:bg-blue-50 font-medium">Save</button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Right panel: tagged transactions */}
                <div className="lg:col-span-2">
                  {selectedTag ? (
                    <div className="bg-white rounded-lg shadow-sm overflow-hidden">
                      <div className="px-4 py-3 border-b border-gray-200 bg-blue-50">
                        <h3 className="font-medium text-gray-800 flex items-center gap-2">
                          <span className="inline-flex px-2 py-1 text-xs rounded-full bg-blue-100">{count}</span>
                          Tagged with: {selectedTag} ({getTaggedTransactions(selectedTag).length})
                        </h3>
                      </div>

                      {getTaggedTransactions(selectedTag).map((tx) => (
                        <TransactionRow key={tx.id} tx={tx} />
                      ))}
                    </div>
                  ) : (
                    <div className="bg-white rounded-lg shadow-sm p-6 text-center">
                      <svg className="w-10 h-10 mx-auto mb-3 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" /></svg>
                      <p className="text-gray-500 mb-2">Select a tag from the left to view corresponding transactions.</p>
                      <button
                        onClick={() => window.location.href = '/wydatki'}
                        className="inline-flex items-center gap-1 text-sm text-blue-500 hover:text-blue-600"
                      >
                        Go to All Transactions &rarr;
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </>
      )}
    </Layout>
  );
}

function TransactionRow({ tx }) {
  return (
    <div className="px-4 py-3 flex items-center justify-between hover:bg-gray-50 transition-colors border-t border-gray-100">
      <span className="text-sm text-gray-400 shrink-0 w-28">{tx.date || tx.transaction_date}</span>

      <div className="flex-1 flex items-center gap-2 min-w-0 ml-3">
        {tx.category_icon && <span>{tx.category_icon}</span>}
        <span className="text-sm font-medium text-gray-700 truncate">{tx.category_name || 'Unknown'}</span>
      </div>

      {tx.description && (
        <span className="flex-1 text-xs text-gray-400 truncatedruncate ml-3 max-w-xs">"{tx.description}"</span>
      )}

      <span className={`font-semibold shrink-0 ${(typeof tx.amount === 'number' ? tx.amount : parseFloat(tx.amount)) > 0 && (tx.type || '') !== 'Przychod' ? 'text-red-500' : 'text-blue-600'} ml-3`}>
        {Math.abs(Number(tx.amount) || 0).toFixed(2)} PLN
      </span>

      <button onClick={() => window.location.href = '/wydatki'} className="ml-3 p-1.5 text-gray-400 hover:text-blue-600 rounded-md">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101" /></svg>
      </button>
    </div>
  );
}
