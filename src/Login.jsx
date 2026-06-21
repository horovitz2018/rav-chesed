import React, { useState } from 'react';
import { supabase } from './supabaseClient.js';
import { ORG } from './config.js';

export function Login() {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [showCode, setShowCode] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setError(''); setInfo(''); setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: code });
    setLoading(false);
    if (error) {
      setError(error.message?.includes('confirm')
        ? 'החשבון טרם אושר. סמן "Auto Confirm User" ב-Supabase.'
        : 'אימייל או קוד שגויים. נסה שוב.');
    }
    // בהצלחה — App יזהה את ההתחברות ויעבור למערכת
  };

  const forgot = async () => {
    setError(''); setInfo('');
    if (!email.trim()) { setError('הזן קודם את כתובת המייל, ואז לחץ "שכחתי קוד".'); return; }
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: window.location.origin });
    if (error) setError('שליחת קישור האיפוס נכשלה.');
    else setInfo('אם הכתובת קיימת במערכת — נשלח אליה קישור לאיפוס הקוד.');
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-700 via-indigo-800 to-indigo-900 p-4" dir="rtl">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md p-8 space-y-6">
        {/* לוגו ושם */}
        <div className="text-center space-y-2">
          <div className="inline-flex bg-indigo-50 p-3 rounded-2xl">
            <svg className="w-8 h-8 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
            </svg>
          </div>
          <h1 className="text-2xl font-black text-slate-900">{ORG.name}</h1>
          <p className="text-sm text-slate-500">{ORG.tagline}</p>
        </div>

        <div className="border-t border-slate-100 pt-5 text-center">
          <h2 className="text-lg font-bold text-slate-800">ברוכים הבאים</h2>
          <p className="text-xs text-slate-400">התחבר כדי להמשיך</p>
        </div>

        {error && <div className="bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-xl p-3 text-center">{error}</div>}
        {info && <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm rounded-xl p-3 text-center">{info}</div>}

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-slate-500 mb-1 uppercase tracking-wide">אימייל</label>
            <input
              required autoFocus type="email" value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full border border-slate-200 rounded-xl p-3 focus:ring-2 focus:ring-indigo-400 focus:outline-none"
              placeholder="email@example.com" dir="ltr"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-500 mb-1 uppercase tracking-wide">קוד כניסה</label>
            <div className="relative">
              <input
                required type={showCode ? 'text' : 'password'} value={code}
                onChange={(e) => setCode(e.target.value)}
                className="w-full border border-slate-200 rounded-xl p-3 pl-14 focus:ring-2 focus:ring-indigo-400 focus:outline-none"
                placeholder="••••••••" dir="ltr"
              />
              <button type="button" onClick={() => setShowCode((s) => !s)} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs font-bold">
                {showCode ? 'הסתר' : 'הצג'}
              </button>
            </div>
          </div>
          <button type="submit" disabled={loading} className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl py-3 transition disabled:bg-slate-300">
            {loading ? 'מתחבר...' : 'כניסה למערכת'}
          </button>
        </form>

        <div className="text-center">
          <button onClick={forgot} className="text-sm text-indigo-600 hover:text-indigo-800 font-semibold">שכחתי קוד?</button>
        </div>

        <p className="text-xs text-slate-400 text-center border-t border-slate-100 pt-4">🔒 גישה מאובטחת למורשים בלבד · {ORG.name}</p>
      </div>
    </div>
  );
}
