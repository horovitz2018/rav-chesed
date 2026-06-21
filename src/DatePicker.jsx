import React, { useState } from 'react';

const pad = (n) => String(n).padStart(2, '0');
const toStr = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`; // m = 0-based
const parse = (s) => {
  const [Y, M, D] = (s || '').split('-').map(Number);
  return Y ? new Date(Y, M - 1, D) : new Date();
};

const WEEKDAYS = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש'];

const fmtGreg = (date) => new Intl.DateTimeFormat('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(date);
const fmtGregMonthYear = (date) => new Intl.DateTimeFormat('he-IL', { month: 'long', year: 'numeric' }).format(date);

// המרת מספר לגימטריה עברית (Intl לא אמין לכך, ממירים ידנית)
function gematria(n) {
  const ones = ['', 'א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח', 'ט'];
  const tens = ['', 'י', 'כ', 'ל', 'מ', 'נ', 'ס', 'ע', 'פ', 'צ'];
  const huns = ['', 'ק', 'ר', 'ש', 'ת', 'תק', 'תר', 'תש', 'תת', 'תתק'];
  let r = huns[Math.floor(n / 100)] || '';
  n %= 100;
  if (n === 15) r += 'טו';
  else if (n === 16) r += 'טז';
  else { r += tens[Math.floor(n / 10)] || ''; r += ones[n % 10] || ''; }
  if (r.length === 1) r += '׳';
  else if (r.length > 1) r = r.slice(0, -1) + '״' + r.slice(-1);
  return r;
}

// שליפת רכיבי התאריך העברי (שם החודש מ-Intl, מספרים מומרים לגימטריה)
function hebParts(date) {
  const p = new Intl.DateTimeFormat('he-IL-u-ca-hebrew', { day: 'numeric', month: 'long', year: 'numeric' }).formatToParts(date);
  const g = (t) => p.find((x) => x.type === t)?.value || '';
  return { day: Number(g('day')), month: g('month'), year: Number(g('year')) };
}

const fmtHebFull = (date) => { const h = hebParts(date); return `${gematria(h.day)} ב${h.month} ${gematria(h.year % 1000)}`; };
const fmtHebDay = (date) => gematria(hebParts(date).day);
const fmtHebMonthYear = (date) => { const h = hebParts(date); return `${h.month} ${gematria(h.year % 1000)}`; };

// בורר תאריך עם תמיכה בתצוגה עברית. משאיר input מוסתר בשם name כדי לעבוד עם FormData.
export function DatePicker({ name, defaultValue, required }) {
  const todayStr = toStr(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());
  const [value, setValue] = useState(defaultValue || todayStr);
  const [open, setOpen] = useState(false);
  const [hebrew, setHebrew] = useState(false);
  const init = parse(defaultValue || todayStr);
  const [viewY, setViewY] = useState(init.getFullYear());
  const [viewM, setViewM] = useState(init.getMonth());

  const selected = parse(value);
  const firstWeekday = new Date(viewY, viewM, 1).getDay();
  const daysInMonth = new Date(viewY, viewM + 1, 0).getDate();
  const today = new Date();
  const isToday = (d) => today.getFullYear() === viewY && today.getMonth() === viewM && today.getDate() === d;
  const isSelected = (d) => value === toStr(viewY, viewM, d);

  const prevMonth = () => { const m = viewM - 1; if (m < 0) { setViewM(11); setViewY(viewY - 1); } else setViewM(m); };
  const nextMonth = () => { const m = viewM + 1; if (m > 11) { setViewM(0); setViewY(viewY + 1); } else setViewM(m); };

  const pick = (d) => { setValue(toStr(viewY, viewM, d)); setOpen(false); };

  const firstOfMonth = new Date(viewY, viewM, 1);
  const lastOfMonth = new Date(viewY, viewM, daysInMonth);
  const hebHeader = (() => {
    const a = fmtHebMonthYear(firstOfMonth), b = fmtHebMonthYear(lastOfMonth);
    return a === b ? a : `${a} – ${b}`;
  })();

  return (
    <div className="relative">
      <input type="hidden" name={name} value={value} required={required} />
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full border border-slate-200 rounded-lg p-2 text-right bg-white hover:border-indigo-300 focus:ring-2 focus:ring-indigo-400 focus:outline-none flex justify-between items-center"
      >
        <span className="font-medium text-slate-800">
          {hebrew ? fmtHebFull(selected) : fmtGreg(selected)}
        </span>
        <span className="text-slate-400 text-xs">{hebrew ? fmtGreg(selected) : fmtHebFull(selected)}</span>
      </button>

      {open && (
        <div className="mt-2 border border-slate-200 rounded-xl bg-white shadow-lg p-3 space-y-2">
          {/* כותרת + ניווט + מתג עברי/לועזי */}
          <div className="flex items-center justify-between">
            <button type="button" onClick={prevMonth} className="px-2 py-1 rounded hover:bg-slate-100 text-slate-500 font-bold">›</button>
            <div className="text-center">
              <p className="font-bold text-slate-800 text-sm">{fmtGregMonthYear(firstOfMonth)}</p>
              {hebrew && <p className="text-[11px] text-indigo-600 font-semibold">{hebHeader}</p>}
            </div>
            <button type="button" onClick={nextMonth} className="px-2 py-1 rounded hover:bg-slate-100 text-slate-500 font-bold">‹</button>
          </div>

          <div className="flex justify-center">
            <button
              type="button"
              onClick={() => setHebrew((h) => !h)}
              className={`text-xs font-bold px-3 py-1 rounded-full transition ${hebrew ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
            >
              {hebrew ? '🔯 תצוגה עברית' : '📅 הצג תאריך עברי'}
            </button>
          </div>

          {/* כותרות ימי שבוע */}
          <div className="grid grid-cols-7 gap-1 text-center">
            {WEEKDAYS.map((w) => (<div key={w} className="text-[10px] font-bold text-slate-400 py-1">{w}</div>))}
            {Array.from({ length: firstWeekday }).map((_, i) => (<div key={`b${i}`} />))}
            {Array.from({ length: daysInMonth }).map((_, i) => {
              const d = i + 1;
              const cellDate = new Date(viewY, viewM, d);
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => pick(d)}
                  className={`rounded-lg py-1.5 text-xs transition flex flex-col items-center leading-tight ${
                    isSelected(d) ? 'bg-indigo-600 text-white font-bold' : isToday(d) ? 'bg-indigo-50 text-indigo-700 font-bold' : 'hover:bg-slate-100 text-slate-700'
                  }`}
                >
                  <span>{d}</span>
                  {hebrew && <span className={`text-[9px] ${isSelected(d) ? 'text-indigo-100' : 'text-slate-400'}`}>{fmtHebDay(cellDate)}</span>}
                </button>
              );
            })}
          </div>

          <div className="flex justify-between items-center pt-1 border-t border-slate-100">
            <button type="button" onClick={() => { const t = new Date(); setViewY(t.getFullYear()); setViewM(t.getMonth()); setValue(todayStr); setOpen(false); }} className="text-xs text-indigo-600 font-bold hover:underline">היום</button>
            <button type="button" onClick={() => setOpen(false)} className="text-xs text-slate-500 font-bold hover:underline">סגור</button>
          </div>
        </div>
      )}
    </div>
  );
}
