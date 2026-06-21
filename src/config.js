// ═══════════════════════════════════════════════════════════════
//  הגדרות הארגון — ערוך כאן בקלות את שם העמותה והקטגוריות
// ═══════════════════════════════════════════════════════════════

export const ORG = {
  name: 'רב חסד',
  legalName: 'עמותת רב חסד (ע״ר)',
  tagline: 'מערכת חכמה לניהול תרומות וחלוקת כספים',
  currency: 'EUR',
  currencySymbol: '€',
  version: '1.0.0',
};

// ─── הגדרות התחברות ───
// חשבון הכניסה הקבוע. הקוד שתגדיר הוא הסיסמה של חשבון זה ב-Supabase.
// (המשתמש לא מקליד את האימייל — הוא מוגדר כאן מאחורי הקלעים.)
export const AUTH_EMAIL = 'admin@ravchesed.app';

// ─── הגדרות Stripe ───
// כדי לאפשר תרומות אונליין: צור "Payment Link" בלוח הבקרה של Stripe
// (https://dashboard.stripe.com/payment-links) והדבק כאן את הכתובת.
export const STRIPE = {
  // הדבק כאן את קישור התרומה שלך, לדוגמה: 'https://buy.stripe.com/xxxxxxxx'
  paymentLinkUrl: '',
};

// קטגוריות הסיוע/תמיכה שהארגון מעניק לנתמכים
export const SUPPORT_CATEGORIES = [
  'מזון',
  'דירה / שכירות',
  'הוצאה לפועל',
  'טיפולים רפואיים',
  'מענקי חגים',
  'מענקים לשבתות',
  'אחר',
];

// קטגוריות הוצאות תפעוליות של העמותה
export const EXPENSE_CATEGORIES = [
  { value: 'קבועה', label: 'קבועה (שכירות, שכר, מנהלה)' },
  { value: 'משתנה', label: 'משתנה (ספקים, עמלות, החזרים)' },
  { value: 'ביצועית', label: 'ביצועית (פרסום ומגביות)' },
];

// רמות דחיפות לבקשות תמיכה
export const PRIORITY_LEVELS = ['נמוכה', 'בינונית', 'גבוהה', 'קריטית'];

// ═══════════════════════════════════════════════════════════════
//  נתונים התחלתיים (Seed) — נטענים רק בפעם הראשונה.
//  לאחר מכן הכל נשמר אוטומטית בדפדפן (localStorage).
// ═══════════════════════════════════════════════════════════════

export const INITIAL_FUNDRAISERS = [
  { id: 'fund-1', name: 'מתרים ראשי', email: 'main@rav-chesed.org', phone: '050-0000000', target: 200000 },
];

export const INITIAL_DONORS = [
  { id: 'donor-1', name: 'תורם לדוגמה', email: 'donor@example.com', phone: '050-1234567', totalDonated: 0, assignedFundraiserId: 'fund-1', city: 'ירושלים' },
];

export const INITIAL_CAMPAIGNS = [
  { id: 'camp-1', name: 'קרן חסד כללית', target: 300000, raised: 0, category: 'כללי' },
  { id: 'camp-2', name: 'מענקי חגים', target: 100000, raised: 0, category: 'מענקי חגים' },
];

export const INITIAL_RECIPIENTS = [];

export const INITIAL_SUPPORT_REQUESTS = [];

export const INITIAL_EXPENSES = [];

export const INITIAL_DONATIONS = [];
