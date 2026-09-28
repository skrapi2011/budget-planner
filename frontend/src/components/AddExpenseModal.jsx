import React, { useState, useEffect } from 'react';
import { useToast } from './ToastContext';
import { localDateStr } from '../utils/date';
import * as api from '../api';

export default function AddExpenseModal({ isOpen, onClose, onSubmit, activeCategories = [], initial = null }) {
  // Escape closes the modal.
  useEffect(() => {
    if (!isOpen) return undefined;
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center bg-black/40 transition-opacity duration-200 ${
        isOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
      }`}
      onClick={onClose}
    >
      <div
        className={`relative w-full max-w-md mx-4 p-6 bg-white dark:bg-slate-800 rounded-lg shadow-lg pointer-events-auto transition-transform duration-200 ${
          isOpen ? 'scale-100' : 'scale-95'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="absolute top-3 right-3 text-gray-400 hover:text-gray-600 dark:hover:text-slate-300 transition-colors"
          onClick={onClose}
          aria-label="Zamknij"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        <h2 className="mb-4 text-xl font-semibold text-gray-900 dark:text-slate-100">{initial ? 'Edytuj transakcję' : 'Dodaj wydatek'}</h2>

        <Form isOpen={isOpen} categories={activeCategories} onClose={onClose} onSubmit={onSubmit} initial={initial} />
      </div>
    </div>
  )
}

function Form({ isOpen, categories, onClose, onSubmit, initial = null }) {
  const { error: toastError } = useToast();
  const [type, setType] = useState('wydatek')
  const [amount, setAmount] = useState('')
  const [description, setDescription] = useState('')
  const [date, setDate] = useState(localDateStr())
  const [tagsText, setTagsText] = useState('')
  const [knownTags, setKnownTags] = useState([])
  const [categoryId, setCategoryId] = useState('')

  useEffect(() => {
    if (isOpen) {
      // Prefill from `initial` when editing, reset to defaults when adding.
      setType(initial?.type || 'wydatek')
      setAmount(initial?.amount != null ? String(initial.amount) : '')
      setDescription(initial?.description || '')
      setDate(initial?.date || localDateStr())
      setTagsText(Array.isArray(initial?.tags) ? initial.tags.join(', ') : '')
      setCategoryId(initial?.category_id != null ? String(initial.category_id) : '')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, initial])

  // Suggestions for the tag field (audit P0-22: the whole tags infrastructure was
  // unreachable from the UI because the modal had no tag input).
  useEffect(() => {
    if (!isOpen) return;
    api.getAllTags().then((t) => setKnownTags(t || [])).catch(() => setKnownTags([]));
  }, [isOpen])

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!categoryId) {
      toastError('Wybierz kategorię');
      return;
    }

    const trimmedDescription = description.trim();
    const amt = parseFloat(amount);
    // Same guard as the inline budget edit (P0-16): an empty/garbage amount used to be
    // sent as NaN and rejected by the backend with a bare 400.
    if (!Number.isFinite(amt) || amt <= 0) {
      toastError('Podaj poprawną kwotę (większą od zera)');
      return;
    }
    const tagsList = tagsText.split(',').map((t) => t.trim()).filter(Boolean);
    onSubmit({ type, amount: amt, description: trimmedDescription || null, date, categoryId, tags: tagsList })
    onClose()
  }

  const handleCancel = () => {
    setType('wydatek')
    setAmount('')
    setDescription('')
    setDate(localDateStr())
    setTagsText('')
    setCategoryId('')
    onClose()
  }

  if (!isOpen) return null

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Typ */}
     <div>
        <label htmlFor="typ" className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Typ</label>
        <select
          id="typ"
          autoFocus
          value={type}
          onChange={(e) => setType(e.target.value)}
  className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-gray-900 dark:text-slate-100 rounded-md shadow-sm focus:outline-none focus:ring-[#32a852] focus:border-[#32a852]"
        >
          <option value="wydatek">Wydatek</option>
          <option value="Przychod">Przychod</option>
        </select>
      </div>

      {/* Opis */}
      <div>
        <label htmlFor="opis" className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Opis</label>
        <input
          type="text"
          id="opis"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Krótki opis"
          className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-gray-900 dark:text-slate-100 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
        />
      </div>

      {/* Kwota */}
      <div>
        <label htmlFor="kwota" className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Kwota</label>
        <input
          type="number"
          id="kwota"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="np. 50.00"
          step="0.01"
          min="0"
          required
          className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-gray-900 dark:text-slate-100 rounded-md shadow-sm focus:outline-none focus:ring-[#32a852] focus:border-[#32a852]"
        />
      </div>

      {/* Data */}
      <div>
        <label htmlFor="data" className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Data</label>
        <input
          type="date"
          id="data"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-gray-900 dark:text-slate-100 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
        />
      </div>

      {/* Tagi */}
      <div>
        <label htmlFor="tagi" className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Tagi <span className="font-normal text-gray-400 dark:text-slate-500">(po przecinku)</span></label>
        <input
          type="text"
          id="tagi"
          value={tagsText}
          onChange={(e) => setTagsText(e.target.value)}
          placeholder="np. dom, zakupy"
          list="known-tags"
          className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-gray-900 dark:text-slate-100 rounded-md shadow-sm focus:outline-none focus:ring-[#32a852] focus:border-[#32a852]"
        />
        {knownTags.length > 0 && (
          <datalist id="known-tags">
            {knownTags.map((t) => <option key={t} value={t} />)}
          </datalist>
        )}
      </div>

      {/* Kategoria */}
      <div>
        <label htmlFor="kategoria" className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Kategoria</label>
        <select
          id="kategoria"
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-gray-900 dark:text-slate-100 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
        >
          <option value="">-- Wybierz kategorię --</option>
          {categories.map((cat) => (
            <option key={cat.id} value={cat.id}>
              {cat.name}
            </option>
          ))}
        </select>
      </div>

      {/* buttons */}
      <div className="flex gap-3 justify-end pt-2">
        <button type="button" onClick={handleCancel} className="px-4 py-2 text-sm font-medium rounded-md shadow-sm bg-gray-200 hover:bg-gray-300 transition-colors">
          Anuluj
        </button>
        <button type="submit" className="px-4 py-2 text-sm font-medium rounded-md shadow-sm text-white bg-[#32a852] hover:bg-[#1f8c42] transition-colors">
          Dodaj
        </button>
      </div>
    </form>
  )
}
