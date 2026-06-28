// ─── עזרי CSV ליבוא רשימת תורמים (ללא תלות חיצונית) ───

// זיהוי תוחם אוטומטי לפי שורת הכותרת (Excel אירופי מייצא עם ';')
function detectDelimiter(headerLine) {
  const counts = { ',': 0, ';': 0, '\t': 0 };
  let inQ = false;
  for (const ch of headerLine) {
    if (ch === '"') inQ = !inQ;
    else if (!inQ && counts[ch] !== undefined) counts[ch]++;
  }
  const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return best[1] > 0 ? best[0] : ',';
}

// מנתח CSV → { headers: string[], rows: string[][] }
// שורות כמערכי תאים (לפי אינדקס) כדי לעמוד בכותרות ריקות/כפולות.
export function parseCSV(text) {
  if (!text) return { headers: [], rows: [] };
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // BOM

  const nl = text.search(/\r?\n/);
  const headerLine = nl === -1 ? text : text.slice(0, nl);
  const delim = detectDelimiter(headerLine);

  const all = [];
  let field = '', row = [], inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i], next = text[i + 1];
    if (inQ) {
      if (ch === '"' && next === '"') { field += '"'; i++; }
      else if (ch === '"') inQ = false;
      else field += ch;
    } else {
      if (ch === '"') inQ = true;
      else if (ch === delim) { row.push(field); field = ''; }
      else if (ch === '\r') { /* skip */ }
      else if (ch === '\n') { row.push(field); all.push(row); row = []; field = ''; }
      else field += ch;
    }
  }
  if (field !== '' || row.length) { row.push(field); all.push(row); }
  if (!all.length) return { headers: [], rows: [] };

  const headers = all[0].map(h => h.trim());
  const rows = all.slice(1).filter(r => r.some(c => (c ?? '').trim() !== ''));
  return { headers, rows };
}

// אינדקס העמודה הראשונה שכותרתה מכילה אחד מהמועמדים (להתאמה אוטומטית)
export function pickColumn(headers, candidates) {
  for (let i = 0; i < headers.length; i++) {
    const h = (headers[i] || '').toLowerCase();
    if (candidates.some(c => h.includes(c.toLowerCase()))) return i;
  }
  return -1;
}

// נרמול טלפון — ספרות בלבד (+ קידומת + אופציונלית). לאחסון ולדה-דופ.
export function normalizePhone(value) {
  if (!value) return '';
  const s = value.toString().trim();
  const plus = s.startsWith('+') ? '+' : '';
  return plus + s.replace(/\D/g, '');
}

// פירוק סכום בפורמט אירופי/בלגי: 25 · 25,00 · 1.200,50 · € 50 · 50 €
export function parseEuroAmount(value) {
  if (value == null) return 0;
  let s = value.toString().replace(/[€\s]/g, '');
  if (!s) return 0;
  s = s.replace(/[^\d.,-]/g, '');
  if (s.includes(',')) {
    s = s.replace(/\./g, '').replace(',', '.');   // ',' עשרונית, '.' אלפים
  } else if (s.includes('.')) {
    const parts = s.split('.');
    const last = parts[parts.length - 1];
    if (parts.length > 1 && last.length === 3) s = parts.join(''); // '.' אלפים
    // אחרת '.' נשאר עשרוני
  }
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

// מיפוי "אופן גבייה" ל-enum הקיים. מחזיר { method, matched }.
export function normalizePledgeMethod(value) {
  const v = (value || '').toString().trim().toLowerCase();
  if (!v) return { method: 'bank', matched: true };
  if (['cash', 'מזומן', 'contant'].some(k => v.includes(k))) return { method: 'cash', matched: true };
  if (['bank', 'בנק', 'overschrijving'].some(k => v.includes(k))) return { method: 'bank', matched: true };
  if (['stripe', 'סטרייפ', 'אשראי'].some(k => v.includes(k))) return { method: 'stripe', matched: true };
  return { method: 'bank', matched: false };
}
