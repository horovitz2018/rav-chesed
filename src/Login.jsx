import React, { useState } from 'react';
import { supabase } from './supabaseClient.js';
import { ORG } from './config.js';

export function Login() {
  const [step, setStep] = useState('email'); // 'email' | 'code'
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  const sendCode = async (e) => {
    e.preventDefault();
    setError(''); setInfo(''); setLoading(true);
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { shouldCreateUser: false },
    });
    setLoading(false);
    if (error) {
      setError(error.message?.includes('not allowed') || error.message?.includes('Signups')
        ? 'כתובת זו אינה מורשית להתחבר למערכת.'
        : 'שליחת הקוד נכשלה. בדוק את כתובת המייל ונסה שוב.');
    } else {
      setInfo(`קוד בן 6 ספרות נשלח לכתובת ${email.trim()}`);
      setStep('code');
    }
  };

  const verify = async (e) => {
    e.preventDefault();
    setError(''); setLoading(true);
    const { error } = await supabase.auth.verifyOtp({ email: email.trim(), token: code.trim(), type: 'email' });
    setLoading(false);
    if (error) setError('הקוד שגוי או שפג תוקפו. נסה שוב.');
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
        {info && step === 'code' && <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm rounded-xl p-3 text-center">{info}</div>}

        {step === 'email' ? (
          <form onSubmit={sendCode} className="space-y-4">
            <div>
              <label className="block text-sm font-bold text-slate-600 mb-1">כתובת אימייל</label>
              <input
                required type="email" autoFocus value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full border border-slate-200 rounded-xl p-3 focus:ring-2 focus:ring-indigo-400 focus:outline-none"
                placeholder="you@example.com"
                dir="ltr"
              />
            </div>
            <button type="submit" disabled={loading} className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl py-3 transition disabled:bg-slate-300">
              {loading ? 'שולח קוד...' : 'שלח לי קוד כניסה'}
            </button>
            <p className="text-xs text-slate-400 text-center">קוד חד-פעמי יישלח לכתובת המייל שלך</p>
          </form>
        ) : (
          <form onSubmit={verify} className="space-y-4">
            <div>
              <label className="block text-sm font-bold text-slate-600 mb-1">הקוד שקיבלת במייל</label>
              <input
                required autoFocus value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                inputMode="numeric" maxLength={6}
                className="w-full border border-slate-200 rounded-xl p-3 text-center text-2xl font-black tracking-[0.5em] focus:ring-2 focus:ring-indigo-400 focus:outline-none"
                placeholder="••••••"
                dir="ltr"
              />
            </div>
            <button type="submit" disabled={loading || code.length < 6} className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl py-3 transition disabled:bg-slate-300">
              {loading ? 'מאמת...' : 'כניסה למערכת'}
            </button>
            <button type="button" onClick={() => { setStep('email'); setCode(''); setError(''); }} className="w-full text-sm text-slate-500 hover:text-slate-700 font-semibold">
              ← שינוי כתובת מייל / שליחה מחדש
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
