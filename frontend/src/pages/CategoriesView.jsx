import { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import * as api from '../api';

const ICON_OPTIONS = '\u{1F3C9}\u{1F697}\u{1F3E0}\u{1F3AE}\u{1F48A}\u{1F4DA}\u{1F455}\u{1F4F1}\u{1F3E1}\u{1F381}\u{1F6C6}\u{1F3AF}\u{1F4B0}\u{1F527}'.split('');

export default function CategoriesView({ user }) {
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState('#32a852');
  const [newIcon, setNewIcon] = useState('\u{1F4C1}');

  useEffect(() => { loadCategories(); }, []);

  async function loadCategories() {
    setLoading(true);
    try {
      const data = await api.getCategories(undefined);
      setCategories(data || []);
    } catch (err) { console.error(err); setCategories([]); }
    finally { setLoading(false); }
  }

  const handleSaveNew = async () => {
    if (!newName.trim()) return;
    try {
      await api.createCategory({ name: newName, color: newColor, icon: newIcon });
      setNewName('');
      setNewColor('#32a852');
      setNewIcon('\u{1F4C1}');
      setShowForm(false);
      loadCategories();
    } catch (err) { alert(err.message || 'Nie udalo sie dodac kategorii'); }
  };

  const handleUpdateCategory = async () => {
     try {
       await api.updateCategory(editing.id, { name: editing.name, color: editing.color, icon: editing.icon, active: editing.active });
       setEditing(null);
       loadCategories();
     } catch (err) { alert(err.message || 'Nie udalo sie zaktualizowac kategorii'); }
   };

  const handleDelete = async () => {
    if (!editing || !confirm('Usunąć tę kategorię?')) return;
    try {
      await api.deleteCategory(editing.id);
      setEditing(null);
      loadCategories();
    } catch (err) { alert(err.message || 'Nie udalo sie usunac kategorii'); }
  };

  const handleToggleActive = async () => {
    if (!editing) return;
    try {
      await api.updateCategory(editing.id, { active: editing.active ? 0 : 1 });
      const newActiveValue = editing.active === 0 || editing.active === false ? 1 : 0;
      setEditing({ ...editing, active: newActiveValue });
      setCategories(prev => prev.map(c => c.id === editing.id ? { ...c, active: newActiveValue } : c));
    } catch (err) { alert(err.message || 'Nie udalo sie zaktualizowac kategorii'); }
  };

  const quickSelectIcon = (icon) => setNewIcon(icon);

  return (
    <Layout username={user}>
      <div className="mb-6">
        <h2 className="text-xl font-bold text-gray-900 mb-1">Zarządzanie kategoriami</h2>
        <p className="text-sm text-gray-500">Dodawaj, edytuj i usuwaj swoje kategorie wydatków</p>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-16">
          <div className="w-8 h-8 border-4 border-[#32a852]20 border-t-[#32a852] rounded-full animate-spin" />
        </div>
      )}

      {!loading && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left panel */}
          <div className="lg:col-span-1 space-y-4">
            {editing ? (
              <div className="bg-white dark:bg-slate-800 rounded-lg shadow-sm p-5 border border-gray-200 dark:border-slate-700">
                <h3 className="font-semibold text-gray-800 dark:text-slate-200 mb-4 flex items-center justify-between">
                  Edytuj kategorię
                  <button onClick={() => setEditing(null)} className="text-gray-400 hover:text-gray-600 dark:hover:text-slate-300" aria-label="Zamknij edycję">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                  </button>
                </h3>

 <div className="space-y-3">
                  {Object.keys(editing).filter(k => ['name', 'icon'].includes(k)).map(key => (
                    <div key={key}>
                      <label htmlFor={`edit-${key}`} className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">{key === 'name' ? 'Nazwa' : 'Ikona'}</label>
                      <input id={`edit-${key}`} value={editing[key]} onChange={(e) => setEditing({ ...editing, [key]: e.target.value })} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-gray-900 dark:text-slate-100 rounded-md focus:ring-[#32a852] focus:border-[#32a852]" />
                    </div>
                  ))}

                  <div className="flex gap-2 items-center">
                    <label htmlFor="edit-color" className="text-sm font-medium text-gray-700 dark:text-slate-300">Kolor</label>
                    <input id="edit-color" type="color" value={editing.color || '#32a852'} onChange={(e) => setEditing({ ...editing, color: e.target.value })} className="w-10 h-10 rounded-md border border-gray-300 dark:border-slate-600 cursor-pointer" />
                  </div>

                  <div className="flex gap-2 pt-4 justify-end">
                    <button onClick={() => setEditing(null)} className="px-4 py-2 text-sm font-medium rounded-md bg-gray-200 hover:bg-gray-300 dark:bg-slate-700 dark:hover:bg-slate-600 transition-colors text-gray-700 dark:text-slate-300">Anuluj</button>
                    <button onClick={handleUpdateCategory} className="px-4 py-2 text-sm font-medium rounded-md text-white bg-[#32a852] hover:bg-[#1f8c42] transition-colors">Zapisz</button>
                  </div>

                  <hr />

                  <button onClick={() => handleToggleActive()} className="w-full px-3 py-1.5 text-xs font-medium rounded-md border border-gray-300 dark:border-slate-600 hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors text-gray-700 dark:text-slate-300">
                    {!!editing.active ? 'Dezaktywuj kategorię' : 'Aktywuj kategorię'}
                  </button>

                  <button onClick={handleDelete} className="w-full px-3 py-1.5 text-xs font-medium rounded-md text-red-700 border border-red-300 hover:bg-red-50 dark:hover:bg-slate-700 transition-colors">Usuń kategorię</button>
                </div>
              </div>
            ) : showForm ? (
              <div className="bg-white dark:bg-slate-800 rounded-lg shadow-sm p-5 border border-gray-200 dark:border-slate-700">
                <h3 className="font-semibold text-gray-800 dark:text-slate-200 mb-4">Nowa kategoria</h3>

                <div className="space-y-3">
                  <div>
                    <label htmlFor="new-name" className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Nazwa</label>
                    <input id="new-name" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="np. Zakupy żywności" className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-gray-900 dark:text-slate-100 rounded-md focus:ring-[#32a852] focus:border-[#32a852]" />
                  </div>

                  <div>
                    <label htmlFor="new-icon" className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Ikona</label>
                    <input id="new-icon" value={newIcon} onChange={(e) => setNewIcon(e.target.value)} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-gray-900 dark:text-slate-100 rounded-md focus:ring-[#32a852] focus:border-[#32a852] mb-3" />
                  </div>

                  <p className="text-xs font-medium text-gray-600 dark:text-slate-400">Szybki wybór ikony:</p>
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    {ICON_OPTIONS.map((ic, idx) => (
                      <button key={idx} type="button" onClick={() => quickSelectIcon(ic)}
                        className={`w-8 h-8 text-lg rounded-md border transition-colors ${newIcon === ic ? 'border-[#32a852] bg-[#32a852]/10' : 'dark:border-slate-600 border-gray-200 hover:bg-gray-100 dark:hover:bg-slate-700'}`}>
                        {ic}
                      </button>
                    ))}
                  </div>

                  <div className="flex gap-2 items-center">
                    <label htmlFor="new-color" className="text-sm font-medium text-gray-700 dark:text-slate-300">Kolor</label>
                    <input id="new-color" type="color" value={newColor} onChange={(e) => setNewColor(e.target.value)} className="w-10 h-10 rounded-md border border-gray-300 dark:border-slate-600 cursor-pointer" />
                  </div>

                  <div className="flex gap-2 pt-4 justify-end">
                    <button onClick={() => setShowForm(false)} className="px-4 py-2 text-sm font-medium rounded-md bg-gray-200 hover:bg-gray-300 dark:bg-slate-700 dark:hover:bg-slate-600 transition-colors text-gray-700 dark:text-slate-300">Anuluj</button>
                    <button onClick={handleSaveNew} disabled={!newName.trim()} className="px-4 py-2 text-sm font-medium rounded-md text-white bg-[#32a852] hover:bg-[#1f8c42] transition-colors disabled:opacity-50">Dodaj</button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="bg-white dark:bg-slate-800 rounded-lg shadow-sm p-5 text-center border border-gray-200 dark:border-slate-700">
                <p className="text-gray-500 dark:text-slate-400 mb-4">Wybierz kategorię z listy po prawej lub dodaj nową</p>
                <button onClick={() => setShowForm(true)} className="px-4 py-2 text-sm font-medium rounded-md text-white bg-[#32a852] hover:bg-[#1f8c42] transition-colors flex items-center gap-2 mx-auto">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                  Dodaj kategorię
                </button>
              </div>
            )}
          </div>

          {/* Right panel - category list */}
          <div className="lg:col-span-2">
            {categories.length === 0 ? (
              <p className="text-center text-gray-500 py-8 bg-white rounded-lg shadow-sm">Brak kategorii</p>
            ) : (
<div className="bg-white dark:bg-slate-800 rounded-lg shadow-sm overflow-hidden border border-gray-200 dark:border-slate-700">
                <table className="min-w-full divide-y divide-gray-200 dark:divide-slate-700">
                  <thead className="bg-gray-50 dark:bg-slate-700/50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">Status</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">Ikona</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">Nazwa</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">Kolor</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200 dark:bg-slate-800 dark:divide-slate-700">
                    {categories.map((cat) => (
                      <tr key={cat.id} onClick={() => setEditing({ ...cat })}
                        className={`cursor-pointer transition-colors ${editing?.id === cat.id ? 'bg-[#32a852]/10' : 'hover:bg-gray-50 dark:hover:bg-slate-700'} ${!cat.active || cat.active === 0 ? 'opacity-60' : ''}`}>
                        <td className="px-4 py-3 text-sm">
                          {cat.active === 0 || cat.active === false
                            ? (<span className="inline-flex px-2 py-1 text-xs font-medium rounded-full bg-gray-200 dark:bg-slate-700 text-gray-700 dark:text-slate-300">Nieaktywna</span>)
                            : (<span className="inline-flex px-2 py-1 text-xs font-medium rounded-full bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-400">Aktywna</span>)}
                        </td>
                        <td className="px-4 py-3 text-lg">{cat.icon || '\u{1F4C1}'}</td>
                        <td className="px-4 py-3 text-sm font-medium text-gray-900 dark:text-slate-200">{cat.name}</td>
                        <td><span style={{ backgroundColor: cat.color || '#94a3b8' }} className="w-6 h-6 rounded-md inline-block border border-gray-200 dark:border-slate-600" /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

            )}
          </div>
        </div>
      )}
    </Layout>
  );
}
