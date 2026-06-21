import React, { useState, useEffect } from 'react';

export default function ModalDodajWydatek({ isOpen, onClose, onSubmit, activeCategories = [] }) {
  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center bg-black/40 transition-opacity duration-200 ${
        isOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
      }`}
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-md mx-4 p-6 bg-white rounded-lg shadow-lg pointer-events-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="absolute top-3 right-3 text-gray-400 hover:text-gray-600 transition-colors"
          onClick={onClose}
          aria-label="Zamknij"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        <h2 className="mb-4 text-xl font-semibold text-gray-900">Dodaj wydatek</h2>

        <Form isOpen={isOpen} categories={activeCategories} onClose={onClose} onSubmit={onSubmit} />
      </div>
    </div>
  )
}

function Form({ isOpen, categories, onClose, onSubmit }) {
  const [type, setType] = useState('wydatek')
  const [amount, setAmount] = useState('')
  const [description, setDescription] = useState('')
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [categoryId, setCategoryId] = useState('')

  useEffect(() => {
    if (isOpen) {
      setType('wydatek')
      setAmount('')
      setDescription('')
      setDate(new Date().toISOString().slice(0, 10))
      setCategoryId('')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) {
      setType('wydatek')
      setAmount('')
      setDescription('')
      setDate(new Date().toISOString().slice(0, 10))
      setCategoryId('')
    }
  })

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!categoryId) {
      alert('Wybierz kategorię');
      return;
    }

    const trimmedDescription = description.trim();
    onSubmit({ type, amount: parseFloat(amount), description: trimmedDescription || null, date, categoryId })
    onClose()
  }

  const handleCancel = () => {
    setType('wydatek')
    setAmount('')
    setDescription('')
    setDate(new Date().toISOString().slice(0, 10))
    setCategoryId('')
    onClose()
  }

  if (!isOpen) return null

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Typ */}
      <div>
        <label htmlFor="typ" className="block text-sm font-medium text-gray-700 mb-1">Typ</label>
        <select
          id="typ"
          value={type}
          onChange={(e) => setType(e.target.value)}
 className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-[#32a852] focus:border-[#32a852]"
        >
          <option value="wydatek">Wydatek</option>
          <option value="Przychod">Przychod</option>
        </select>
      </div>

      {/* Kwota */}
      <div>
        <label htmlFor="kwota" className="block text-sm font-medium text-gray-700 mb-1">Kwota</label>
        <input
          type="number"
          id="kwota"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="np. 50.00"
          step="0.01"
          min="0"
          className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
        />
      </div>

      {/* Opis */}
      <div>
        <label htmlFor="opis" className="block text-sm font-medium text-gray-700 mb-1">Opis</label>
        <input
          type="text"
          id="opis"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Krátki opis"
          className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
        />
      </div>

      {/* Data */}
      <div>
        <label htmlFor="data" className="block text-sm font-medium text-gray-700 mb-1">Data</label>
        <input
          type="date"
          id="data"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
        />
      </div>

      {/* Kategoria */}
      <div>
        <label htmlFor="kategoria" className="block text-sm font-medium text-gray-700 mb-1">Kategoria</label>
        <select
          id="kategoria"
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
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
