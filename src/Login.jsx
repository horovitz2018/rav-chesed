import React, { useState } from 'react';
import { supabase } from './supabaseClient.js';
import { ORG, AUTH_EMAIL } from './config.js';

export function Login() {
  const [code, setCode] = useState('');
  const [showCode, setShowCode] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email: AUTH_EMAIL, password: code });
    setLoading(false);
    if (error) setError('קוד הכניסה שגוי. נסה שוב.');
    // בהצלחה — App יזהה את ההתחברות ויעבור למערכת
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-700 via-indigo-800 to-indigo-900 p-4" dir="rtl">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md p-8 space-y-6">
        <div className="text-center space-y-2">
          <div className="inline-flex bg-indigo-50 p-3 rounded-2xl">
            <svg className="w-8 h-8 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
            </svg>
          </div>
          <h1 className="text-2xl font-black text-slate-900">{ORG.name}</h1>
          <p className="text-sm text-slate-500">{ORG.tagline}</p>
        </div>

        {error && <div className="bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-xl p-3 text-center">{error}</div>}

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="block text-sm font-bold text-slate-600 mb-1">קוד כניסה</label>
            <div className="relative">
              <input
                required autoFocus
                type={showCode ? 'text' : 'password'}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                className="w-full border border-slate-200 rounded-xl p-3 pl-12 focus:ring-2 focus:ring-indigo-400 focus:outline-none text-lg"
                placeholder="הזן את קוד הכניסה"
                dir="ltr"
              />
              <button
                type="button"
                onClick={() => setShowCode((s) => !s)}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs font-bold"
              >
                {showCode ? 'הסתר' : 'הצג'}
              </button>
            </div>
          </div>
          <button type="submit" disabled={loading || !code} className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl py-3 transition disabled:bg-slate-300">
            {loading ? 'מתחבר...' : 'כניסה למערכת'}
          </button>
        </form>

        <p className="text-xs text-slate-400 text-center">גישה למורשים בלבד · {ORG.name}</p>
      </div>
    </div>
  );
}
