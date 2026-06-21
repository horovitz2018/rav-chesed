import React, { useState, useMemo, useEffect } from 'react';
import { Icons } from './Icons.jsx';
import { DatePicker } from './DatePicker.jsx';
import { useData } from './useData.js';
import { startDonationCheckout } from './stripe.js';
import { supabase } from './supabaseClient.js';
import { Login } from './Login.jsx';
import { ORG, SUPPORT_CATEGORIES, EXPENSE_CATEGORIES, PRIORITY_LEVELS } from './config.js';

const C = ORG.currencySymbol;

// אופני תשלום להתחייבות
const PLEDGE_METHODS = [
  { value: 'bank', label: 'העברה בנקאית' },
  { value: 'cash', label: 'מזומן' },
  { value: 'stripe', label: 'אשראי / הו"ק (Stripe)' },
];
const methodLabel = (m) => PLEDGE_METHODS.find(x => x.value === m)?.label || 'העברה בנקאית';

// שער הכניסה — בודק אם המשתמש מחובר; אם לא, מציג מסך כניסה
export default function App() {
  const [session, setSession] = useState(undefined); // undefined = בטעינה
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  if (session === undefined) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50" dir="rtl">
        <div className="w-12 h-12 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin"></div>
      </div>
    );
  }
  if (!session) return <Login />;
  return <MainApp />;
}

function MainApp() {
  const [currentRole, setCurrentRole] = useState('Admin'); // Admin, Staff, Fundraiser, Committee
  const [currentTab, setCurrentTab] = useState('dashboard');
  const [userEmail, setUserEmail] = useState('');
  const handleLogout = () => supabase.auth.signOut();

  // מאגרי נתונים — מחוברים ל-Supabase (בסיס נתונים אמיתי)
  const data = useData();
  const { loading, error, fundraisers, donors, campaigns, recipients, requests, expenses, donations, pledges } = data;

  // מצב הזנת תרומה קבוצתית
  const [donationMode, setDonationMode] = useState('single'); // 'single' | 'multi'
  const [selectedMultiDonorIds, setSelectedMultiDonorIds] = useState([]);
  const [multiDonorSearchText, setMultiDonorSearchText] = useState('');
  const [showMultiDonorDropdown, setShowMultiDonorDropdown] = useState(false);

  // תנועות בנק מיובאות (סימולציה)
  const [bankTransactions, setBankTransactions] = useState([]);
  const [isProcessingBankFile, setIsProcessingBankFile] = useState(false);
  const [bankFileName, setBankFileName] = useState('');

  // מצבי טפסים ומודלים
  const [showAddDonorModal, setShowAddDonorModal] = useState(false);
  const [showAddFundraiserModal, setShowAddFundraiserModal] = useState(false);
  const [showAddDonationModal, setShowAddDonationModal] = useState(false);
  const [showAddRequestModal, setShowAddRequestModal] = useState(false);
  const [showAddExpenseModal, setShowAddExpenseModal] = useState(false);
  const [showAddRecipientModal, setShowAddRecipientModal] = useState(false);
  const [showAddPledgeModal, setShowAddPledgeModal] = useState(false);
  const [payingPledge, setPayingPledge] = useState(null);     // התחייבות שרושמים לה תשלום
  const [historyPledge, setHistoryPledge] = useState(null);   // התחייבות שמציגים את היסטוריית התשלומים שלה
  const [showOnlineDonationModal, setShowOnlineDonationModal] = useState(false);

  // חיפוש ובחירת תורם בהזנת תרומה
  const [selectedDonorId, setSelectedDonorId] = useState('');
  const [donorSearchText, setDonorSearchText] = useState('');
  const [showDonorDropdown, setShowDonorDropdown] = useState(false);

  // מנגנון הודעות מערכת
  const [toast, setToast] = useState(null);
  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  // טיפול בחזרה מ-Stripe (אחרי תשלום)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const d = params.get('donation');
    if (d === 'success') {
      showToast('התרומה התקבלה בהצלחה דרך Stripe! מעדכן נתונים...');
      setTimeout(() => data.reload(), 2000);
      window.history.replaceState({}, '', window.location.pathname);
    } else if (d === 'cancel') {
      showToast('התשלום בוטל.', 'error');
      window.history.replaceState({}, '', window.location.pathname);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserEmail(data.user?.email || ''));
  }, []);

  // הרשאת גישה זמנית לחבר ועד
  const [committeeApprovedAccess, setCommitteeApprovedAccess] = useState(false);
  const [requestingCommitteeAccess, setRequestingCommitteeAccess] = useState(false);

  // חישוב מדדי דאשבורד בזמן אמת
  const stats = useMemo(() => {
    const totalDonations = donations.reduce((sum, d) => sum + d.amount, 0);
    const totalExpenses = expenses.reduce((sum, e) => sum + e.amount, 0);
    const totalApprovedDistributions = requests
      .filter(r => r.status === 'אושר' || r.status === 'שולם')
      .reduce((sum, r) => sum + r.amountApproved, 0);

    const cashFlowBalance = totalDonations - totalExpenses - totalApprovedDistributions;

    return {
      totalDonations,
      totalExpenses,
      totalApprovedDistributions,
      cashFlowBalance,
      pendingRequestsCount: requests.filter(r => r.status === 'בהמתנה').length,
      deficit: cashFlowBalance < 0 ? Math.abs(cashFlowBalance) : 0,
    };
  }, [donations, expenses, requests]);

  // פילוח תזרים חודשי — הכנסות (תרומות) מול הוצאות לכל חודש
  const monthlyFlow = useMemo(() => {
    const MONTH_NAMES = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
    const buckets = {}; // 'YYYY-MM' => { income, expense }

    const ensure = (key) => {
      if (!buckets[key]) buckets[key] = { key, income: 0, expense: 0, distribution: 0 };
      return buckets[key];
    };

    donations.forEach(d => {
      if (!d.date) return;
      ensure(d.date.slice(0, 7)).income += d.amount;
    });
    expenses.forEach(e => {
      if (!e.date) return;
      ensure(e.date.slice(0, 7)).expense += e.amount;
    });
    requests.forEach(r => {
      if (r.status !== 'שולם' || !r.paidDate) return;
      ensure(r.paidDate.slice(0, 7)).distribution += r.amountApproved;
    });

    return Object.values(buckets)
      .sort((a, b) => a.key.localeCompare(b.key))
      .map(b => {
        const [year, month] = b.key.split('-');
        return {
          ...b,
          label: `${MONTH_NAMES[Number(month) - 1]} ${year}`,
          net: b.income - b.expense - b.distribution,
        };
      });
  }, [donations, expenses, requests]);

  // מצב ההתחייבויות — מי שילם החודש, מי בפיגור, וכמה נגבה
  const pledgeStats = useMemo(() => {
    const currentMonth = new Date().toISOString().slice(0, 7);
    const rows = pledges.map(p => {
      const pays = donations.filter(d => d.pledgeId === p.id);
      const paidThisMonth = pays.some(d => (d.date || '').slice(0, 7) === currentMonth);
      const totalPaid = pays.reduce((s, d) => s + d.amount, 0);
      const lastPayment = pays.reduce((m, d) => (d.date > m ? d.date : m), '');
      const startM = (p.startDate || currentMonth).slice(0, 7);
      const activeSinceNow = startM <= currentMonth;
      const due = p.status === 'active' && activeSinceNow && !paidThisMonth;

      // כמה חודשים היו אמורים להיגבות מתחילת ההתחייבות ועד היום
      let expectedMonths = 0;
      if (p.status !== 'cancelled' && activeSinceNow) {
        const [sy, sm] = startM.split('-').map(Number);
        const [cy, cm] = currentMonth.split('-').map(Number);
        expectedMonths = (cy - sy) * 12 + (cm - sm) + 1;
      }
      const paidMonths = new Set(pays.map(d => (d.date || '').slice(0, 7))).size;
      const missedMonths = Math.max(0, expectedMonths - paidMonths);
      const collectionPct = expectedMonths > 0 ? Math.round((paidMonths / expectedMonths) * 100) : (p.status === 'active' ? 100 : 0);

      return { ...p, paidThisMonth, totalPaid, lastPayment, paymentsCount: pays.length, due, expectedMonths, paidMonths, missedMonths, collectionPct };
    });
    const active = rows.filter(p => p.status === 'active');
    return {
      currentMonth,
      rows,
      activeCount: active.length,
      monthlyCommitted: active.reduce((s, p) => s + p.amount, 0),
      collectedThisMonth: donations.filter(d => d.pledgeId && (d.date || '').slice(0, 7) === currentMonth).reduce((s, d) => s + d.amount, 0),
      unpaid: rows.filter(p => p.due),
    };
  }, [pledges, donations]);

  // סינון תורמים דינמי עבור שדה חיפוש
  const filteredDonorsForDonation = useMemo(() => {
    const query = donorSearchText.trim().toLowerCase();
    if (!query) return donors;
    return donors.filter(d =>
      (d.name || '').toLowerCase().includes(query) ||
      (d.city || '').toLowerCase().includes(query) ||
      (d.phone || '').includes(query)
    );
  }, [donors, donorSearchText]);

  // סינון תורמים על פי תפקיד (סימולציה — מתרים רואה את המשויכים למתרים הראשון)
  const visibleDonors = useMemo(() => {
    if (currentRole === 'Fundraiser') {
      const firstFundId = fundraisers[0]?.id;
      return donors.filter(d => d.assignedFundraiserId === firstFundId);
    }
    return donors;
  }, [donors, fundraisers, currentRole]);

  // עוטף פעולה אסינכרונית עם טיפול בשגיאות אחיד
  const run = async (fn, onSuccess) => {
    try {
      const res = await fn();
      if (onSuccess) onSuccess(res);
    } catch (err) {
      console.error(err);
      showToast(err.message || 'אירעה שגיאה בשמירה לשרת', 'error');
    }
  };

  const handleAddFundraiser = (fundData) =>
    run(() => data.addFundraiser(fundData), () => {
      showToast(`המתרים ${fundData.name} נוסף בהצלחה!`);
      setShowAddFundraiserModal(false);
    });

  const handleAddDonor = (donorData) =>
    run(() => data.addDonor(donorData), () => {
      showToast(`התורם ${donorData.name} נוסף בהצלחה!`);
      setShowAddDonorModal(false);
    });

  const handleAssignFundraiser = (donorId, fundraiserId) =>
    run(() => data.assignFundraiser(donorId, fundraiserId), () => {
      const donorName = donors.find(d => d.id === donorId)?.name || 'התורם';
      const fundraiserName = fundraisers.find(f => f.id === fundraiserId)?.name || 'המתרים';
      showToast(`${donorName} שויך לטיפולו של ${fundraiserName}!`);
    });

  const handleAddRecipient = (recData) =>
    run(() => data.addRecipient(recData), () => {
      showToast(`המשפחה ${recData.name} נוספה למאגר הנתמכים.`);
      setShowAddRecipientModal(false);
    });

  const handleAddDonation = (donationData) =>
    run(() => data.addDonation(donationData), () => {
      showToast(`תרומה על סך ${C}${Number(donationData.amount).toLocaleString()} התקבלה ועודכנה בתזרים.`);
      setShowAddDonationModal(false);
    });

  const handleAddMultiDonation = (multiData) => {
    if (multiData.donorIds.length === 0) { showToast('נא לבחור לפחות תורם אחד', 'error'); return; }
    run(() => data.addMultiDonation(multiData), (res) => {
      showToast(`נקלטו ${res.count} תרומות בסך ${C}${res.amount.toLocaleString()} כל אחת (סה"כ: ${C}${(res.amount * res.count).toLocaleString()})`);
      setSelectedMultiDonorIds([]);
      setMultiDonorSearchText('');
      setShowAddDonationModal(false);
    });
  };

  const handleAddRequest = (requestData) =>
    run(() => data.addRequest(requestData), (res) => {
      showToast(`בקשת תמיכה נוספה עם עדיפות מחושבת של ${res.priorityScore}`);
      setShowAddRequestModal(false);
    });

  const handleAddExpense = (expenseData) =>
    run(() => data.addExpense(expenseData), () => {
      showToast(`הוצאה על סך ${C}${Number(expenseData.amount).toLocaleString()} נרשמה בהצלחה.`);
      setShowAddExpenseModal(false);
    });

  const handleSaveDistribution = (allocations) =>
    run(() => data.saveDistribution(allocations), () => showToast('תוכנית החלוקה עודכנה ואושרה במערכת!'));

  const handleMarkAsPaid = (reqId) =>
    run(() => data.markAsPaid(reqId), () => showToast('התמיכה שולמה בהצלחה והועברה לנתמך!'));

  const handleOnlineDonation = (payload) =>
    run(() => startDonationCheckout(payload)); // מפנה ל-Stripe; אם נכשל — מציג שגיאה

  const handleAddPledge = (pledgeData) =>
    run(() => data.addPledge(pledgeData), () => {
      const donorName = donors.find(d => d.id === pledgeData.donorId)?.name || 'התורם';
      showToast(`נרשמה התחייבות של ${donorName} על ${C}${Number(pledgeData.amount).toLocaleString()} לחודש.`);
      setShowAddPledgeModal(false);
    });

  const handlePayPledge = (pledge, opts = {}) =>
    run(() => data.payPledge(pledge, opts), () => {
      const donorName = donors.find(d => d.id === pledge.donorId)?.name || 'התורם';
      const amount = opts.amount != null ? Number(opts.amount) : pledge.amount;
      showToast(`נרשם תשלום של ${C}${amount.toLocaleString()} עבור ${donorName}.`);
      setPayingPledge(null);
    });

  // ייצוא רשימת התחייבויות לקובץ אקסל (CSV עם תמיכה בעברית)
  const handleExportPledges = () => {
    const headers = ['תורם', 'טלפון', 'סכום חודשי', 'אופן תשלום', 'יום חיוב', 'שולם החודש', 'פיגור (חודשים)', 'סה"כ שולם', 'אחוז גבייה', 'סטטוס'];
    const statusHe = { active: 'פעילה', paused: 'מושהית', cancelled: 'בוטלה' };
    const lines = pledgeStats.rows.map(p => {
      const donor = donors.find(d => d.id === p.donorId);
      return [
        donor?.name || '', donor?.phone || '', p.amount, methodLabel(p.method),
        p.billingDay, p.paidThisMonth ? 'כן' : 'לא', p.missedMonths, p.totalPaid,
        `${p.collectionPct}%`, statusHe[p.status] || p.status,
      ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(',');
    });
    const csv = '﻿' + [headers.join(','), ...lines].join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `התחייבויות_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
    showToast('רשימת ההתחייבויות יוצאה לקובץ.');
  };

  const handleSetPledgeStatus = (pledgeId, status) =>
    run(() => data.setPledgeStatus(pledgeId, status), () => {
      const label = status === 'active' ? 'הופעלה מחדש' : status === 'paused' ? 'הושהתה' : 'בוטלה';
      showToast(`ההתחייבות ${label}.`);
    });

  // בקשת גישה של הוועד
  const handleRequestCommitteeAccess = () => {
    setRequestingCommitteeAccess(true);
    setTimeout(() => {
      setCommitteeApprovedAccess(true);
      setRequestingCommitteeAccess(false);
      showToast('אישור גישה זמני הוענק על ידי מנהל המערכת.', 'success');
    }, 1500);
  };

  // הדמיית פענוח קובץ בנק
  const handleSimulateBankUpload = () => {
    if (donors.length === 0) { showToast('יש להוסיף תורם אחד לפחות לפני יבוא בנק', 'error'); return; }
    setIsProcessingBankFile(true);
    setBankFileName('דף_בנק_עו״ש.csv');

    setTimeout(() => {
      const firstDonorId = donors[0]?.id;
      const secondDonorId = donors[1]?.id || firstDonorId;
      const simulatedTx = [
        { id: 'btx-1', date: '2026-05-15', desc: 'העברה בנקאית מאת תורם', amount: 3500, type: 'deposit', suggestedDonorId: firstDonorId, confidence: 95, selectedDonorId: firstDonorId, status: 'pending' },
        { id: 'btx-2', date: '2026-05-18', desc: 'חיוב חברת חשמל לישראל בעמ', amount: 1120, type: 'withdrawal', suggestedCategory: 'קבועה', title: 'חשמל משרד ראשי', status: 'pending' },
        { id: 'btx-3', date: '2026-05-20', desc: 'העברה מאת תורם נוסף', amount: 10000, type: 'deposit', suggestedDonorId: secondDonorId, confidence: 90, selectedDonorId: secondDonorId, status: 'pending' },
        { id: 'btx-4', date: '2026-05-22', desc: 'הוראת קבע ארנונה עיריה', amount: 2800, type: 'withdrawal', suggestedCategory: 'קבועה', title: 'ארנונה משרד', status: 'pending' },
        { id: 'btx-6', date: '2026-05-28', desc: 'פרסום מודעות קמפיין', amount: 4500, type: 'withdrawal', suggestedCategory: 'ביצועית', title: 'שיווק דיגיטלי למגבית', status: 'pending' },
      ];
      setBankTransactions(simulatedTx);
      setIsProcessingBankFile(false);
      showToast('דף הבנק פוענח בהצלחה! זוהו תנועות תואמות.', 'success');
    }, 1200);
  };

  const handleUpdateTxDonor = (txId, donorId) =>
    setBankTransactions(prev => prev.map(tx => tx.id === txId ? { ...tx, selectedDonorId: donorId } : tx));
  const handleUpdateTxCategory = (txId, category) =>
    setBankTransactions(prev => prev.map(tx => tx.id === txId ? { ...tx, suggestedCategory: category } : tx));
  const handleUpdateTxTitle = (txId, title) =>
    setBankTransactions(prev => prev.map(tx => tx.id === txId ? { ...tx, title } : tx));

  // סנכרון תנועות בנק לתזרים (כותב ל-Supabase)
  const handleCommitBankTransactions = () => run(async () => {
    let dCount = 0, eCount = 0;
    const defaultCampId = campaigns[0]?.id;
    for (const tx of bankTransactions) {
      if (tx.type === 'deposit') {
        await data.addDonation({ donorId: tx.selectedDonorId, amount: tx.amount, campaignId: defaultCampId, source: 'בנק', date: tx.date });
        dCount++;
      } else if (tx.type === 'withdrawal') {
        await data.addExpense({ title: tx.title || tx.desc, amount: tx.amount, category: tx.suggestedCategory, date: tx.date });
        eCount++;
      }
    }
    return { dCount, eCount };
  }, (res) => {
    setBankTransactions([]);
    setBankFileName('');
    showToast(`סנכרון הבנק הושלם: נקלטו ${res.dCount} תרומות ו-${res.eCount} הוצאות.`, 'success');
  });

  const roleLabel = (role) =>
    role === 'Admin' ? 'מנהל על' : role === 'Staff' ? 'עובד תפעול' : role === 'Fundraiser' ? 'מתרים שטח' : 'חבר ועד';

  // מסך טעינה
  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center gap-4" dir="rtl">
        <div className="w-12 h-12 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin"></div>
        <p className="text-slate-500 font-semibold">טוען נתונים מהשרת...</p>
      </div>
    );
  }

  // מסך שגיאת התחברות
  if (error) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center gap-4 p-6 text-center" dir="rtl">
        <div className="bg-rose-50 border border-rose-200 rounded-2xl p-6 max-w-md space-y-3">
          <h2 className="text-xl font-black text-rose-700">שגיאה בהתחברות לבסיס הנתונים</h2>
          <p className="text-sm text-rose-600">{error}</p>
          <p className="text-xs text-slate-500">ודא שהרצת את קובץ הסכמה (schema.sql) ב-Supabase, ושפרטי החיבור ב-.env נכונים.</p>
          <button onClick={data.reload} className="px-5 py-2.5 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-xl transition">נסה שוב</button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 font-sans flex flex-col" dir="rtl">

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-5 right-5 z-50 flex items-center p-4 space-x-3 text-white bg-slate-900 rounded-lg shadow-xl animate-bounce space-x-reverse">
          <div className={`w-3 h-3 rounded-full ${toast.type === 'success' ? 'bg-emerald-400' : 'bg-rose-500'}`}></div>
          <p className="text-sm font-semibold">{toast.message}</p>
        </div>
      )}

      {/* Header */}
      <div className="bg-gradient-to-r from-blue-700 via-indigo-800 to-indigo-900 text-white px-6 py-3 flex flex-wrap items-center justify-between gap-4 shadow-md">
        <div className="flex items-center space-x-3 space-x-reverse">
          <div className="bg-white/20 p-1.5 rounded-lg">
            <svg className="w-6 h-6 text-yellow-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
            </svg>
          </div>
          <div>
            <h1 className="text-lg font-extrabold tracking-wide">{ORG.name}</h1>
            <p className="text-xs text-indigo-200">{ORG.tagline}</p>
          </div>
        </div>

        <div className="flex items-center space-x-3 space-x-reverse bg-indigo-950/40 p-2 rounded-xl border border-white/10">
          <span className="text-xs font-semibold text-indigo-200">תפקיד נוכחי:</span>
          <div className="flex rounded-md bg-indigo-950/80 p-0.5">
            {[
              { id: 'Admin', label: '👑 מנהל' },
              { id: 'Staff', label: '👨‍💼 עובד' },
              { id: 'Fundraiser', label: '🎯 מתרים' },
              { id: 'Committee', label: '🏛️ ועד' },
            ].map(role => (
              <button
                key={role.id}
                onClick={() => {
                  setCurrentRole(role.id);
                  setCommitteeApprovedAccess(false);
                  showToast(`עברת לצפייה כ-${role.label}`);
                }}
                className={`px-3 py-1 text-xs rounded transition-all duration-200 ${
                  currentRole === role.id ? 'bg-indigo-600 text-white font-bold shadow' : 'text-slate-300 hover:text-white'
                }`}
              >
                {role.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">

        {/* Sidebar */}
        <aside className="w-64 bg-slate-900 text-slate-300 flex flex-col border-l border-slate-800">
          <div className="p-4 border-b border-slate-800 flex items-center space-x-3 space-x-reverse">
            <div className="h-8 w-8 rounded-full bg-emerald-500 flex items-center justify-center font-bold text-slate-900">
              {currentRole[0]}
            </div>
            <div>
              <p className="text-sm font-semibold text-white">משתמש מחובר</p>
              <p className="text-xs text-slate-400">הרשאה: {roleLabel(currentRole)}</p>
            </div>
          </div>

          <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
            {[
              { id: 'dashboard', label: 'דאשבורד', icon: Icons.Dashboard },
              { id: 'supports_dashboard', label: 'דאשבורד תמיכות', icon: Icons.SupportsDashboard },
              { id: 'donors', label: 'תורמים', icon: Icons.Donors },
              { id: 'fundraisers', label: 'מתרימים ויעדים', icon: Icons.Fundraisers },
              { id: 'donations', label: 'תרומות', icon: Icons.Donations },
              { id: 'pledges', label: 'התחייבויות (הו"ק)', icon: Icons.Pledges },
              { id: 'campaigns', label: 'מגביות', icon: Icons.Campaigns },
              { id: 'recipients', label: 'נתמכים ובקשות', icon: Icons.Recipients },
              { id: 'distribution', label: 'מתכנן חלוקה', icon: Icons.Distribution },
              { id: 'expenses', label: 'הוצאות ותזרים', icon: Icons.Expenses },
              { id: 'bank_import', label: 'יבוא דפי בנק', icon: Icons.BankImport },
              { id: 'settings', label: 'הגדרות', icon: Icons.Settings },
            ].map(item => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  onClick={() => setCurrentTab(item.id)}
                  className={`w-full flex items-center space-x-3 space-x-reverse px-4 py-3 rounded-lg text-sm font-medium transition-colors ${
                    currentTab === item.id ? 'bg-slate-800 text-white font-semibold border-r-4 border-emerald-500' : 'hover:bg-slate-800/50 hover:text-white'
                  }`}
                >
                  <Icon />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>

          <div className="p-4 bg-slate-950 border-t border-slate-800 text-center space-y-2">
            {userEmail && <p className="text-[11px] text-slate-400 truncate" dir="ltr">{userEmail}</p>}
            <button onClick={handleLogout} className="w-full text-xs text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-lg py-2 font-semibold transition flex items-center justify-center gap-2">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
              התנתק
            </button>
            <span className="block text-xs text-slate-500">{ORG.name} • גרסה v{ORG.version}</span>
          </div>
        </aside>

        {/* Content */}
        <main className="flex-1 overflow-y-auto p-8">

          {/* Dashboard */}
          {currentTab === 'dashboard' && (
            <div className="space-y-8">
              <div className="flex justify-between items-center">
                <div>
                  <h2 className="text-2xl font-black text-slate-900">לוח בקרה פיננסי ותפעולי</h2>
                  <p className="text-slate-500">סקירה כללית של {ORG.name} בזמן אמת</p>
                </div>
                <div className="flex space-x-3 space-x-reverse">
                  <button
                    onClick={() => {
                      setSelectedDonorId('');
                      setDonorSearchText('');
                      setShowDonorDropdown(false);
                      setShowAddDonationModal(true);
                    }}
                    className="flex items-center px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl shadow font-semibold transition"
                  >
                    <Icons.Plus /> תרומה חדשה
                  </button>
                  <button
                    onClick={() => setShowAddDonorModal(true)}
                    className="flex items-center px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-white rounded-xl shadow font-semibold transition"
                  >
                    <Icons.Plus /> תורם חדש
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
                  <p className="text-sm font-semibold text-slate-400">סה"כ הכנסות (תרומות)</p>
                  <h3 className="text-3xl font-black text-slate-900 mt-2">{C}{stats.totalDonations.toLocaleString()}</h3>
                  <div className="mt-2 text-xs text-emerald-600">{donations.length} תרומות רשומות</div>
                </div>

                <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
                  <p className="text-sm font-semibold text-slate-400">הוצאות תפעול ומגביות</p>
                  <h3 className="text-3xl font-black text-slate-900 mt-2">{C}{stats.totalExpenses.toLocaleString()}</h3>
                  <div className="mt-2 text-xs text-slate-500">מתוך תקציב הוצאות</div>
                </div>

                <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
                  <p className="text-sm font-semibold text-slate-400">תמיכות שחולקו בפועל</p>
                  <h3 className="text-3xl font-black text-indigo-600 mt-2">{C}{stats.totalApprovedDistributions.toLocaleString()}</h3>
                  <div className="mt-2 text-xs text-indigo-500">עבור משפחות נתמכות</div>
                </div>

                <div className={`p-6 rounded-2xl shadow-sm border ${stats.cashFlowBalance >= 0 ? 'bg-emerald-50/50 border-emerald-200' : 'bg-rose-50 border-rose-200'}`}>
                  <p className="text-sm font-semibold text-slate-500">יתרת קופה ותזרים פנוי</p>
                  <h3 className={`text-3xl font-black mt-2 ${stats.cashFlowBalance >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                    {C}{stats.cashFlowBalance.toLocaleString()}
                  </h3>
                  <p className="mt-2 text-xs text-slate-600">
                    {stats.cashFlowBalance >= 0 ? 'קופה מאוזנת ויציבה' : 'אזהרה: גירעון פיננסי קיים!'}
                  </p>
                </div>
              </div>

              {stats.deficit > 0 && (
                <div className="bg-yellow-50 border-r-4 border-yellow-500 p-4 rounded-xl flex items-start space-x-3 space-x-reverse shadow-sm">
                  <Icons.Alert />
                  <div>
                    <h4 className="font-bold text-yellow-800">התרעת גירעון תזרימי!</h4>
                    <p className="text-sm text-yellow-700">קיים פער שלילי של {C}{stats.deficit.toLocaleString()} בין ההכנסות להתחייבויות החלוקה וההוצאות.</p>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 lg:col-span-2">
                  <h4 className="font-bold text-slate-900 mb-4">פעילות והתפלגות מגביות</h4>
                  <div className="space-y-4">
                    {campaigns.map(camp => {
                      const percent = Math.min(100, Math.round((camp.raised / Math.max(1, camp.target)) * 100));
                      return (
                        <div key={camp.id} className="space-y-1">
                          <div className="flex justify-between text-xs font-bold text-slate-600">
                            <span>{camp.name}</span>
                            <span>{C}{camp.raised.toLocaleString()} / {C}{camp.target.toLocaleString()} ({percent}%)</span>
                          </div>
                          <div className="w-full bg-slate-100 h-3 rounded-full overflow-hidden">
                            <div className="bg-indigo-500 h-full rounded-full transition-all duration-500" style={{ width: `${percent}%` }}></div>
                          </div>
                        </div>
                      );
                    })}
                    {campaigns.length === 0 && <p className="text-sm text-slate-400 text-center py-8">אין מגביות פעילות עדיין.</p>}
                  </div>
                </div>

                <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
                  <h4 className="font-bold text-slate-900 mb-4">תנועות אחרונות במערכת</h4>
                  <div className="space-y-4">
                    {donations.slice(0, 3).map((don, idx) => {
                      const donorName = donors.find(d => d.id === don.donorId)?.name || 'תורם לא ידוע';
                      return (
                        <div key={idx} className="flex justify-between items-center p-3 hover:bg-slate-50 rounded-xl transition">
                          <div>
                            <p className="text-sm font-bold text-slate-800">{donorName}</p>
                            <p className="text-xs text-slate-400">{don.date} • {don.source}</p>
                          </div>
                          <span className="text-emerald-600 font-extrabold text-sm">+{C}{don.amount.toLocaleString()}</span>
                        </div>
                      );
                    })}
                    {expenses.slice(0, 2).map((exp, idx) => (
                      <div key={idx} className="flex justify-between items-center p-3 hover:bg-slate-50 rounded-xl transition">
                        <div>
                          <p className="text-sm font-bold text-slate-800">{exp.title}</p>
                          <p className="text-xs text-slate-400">{exp.date} • {exp.category}</p>
                        </div>
                        <span className="text-rose-600 font-extrabold text-sm">-{C}{exp.amount.toLocaleString()}</span>
                      </div>
                    ))}
                    {donations.length === 0 && expenses.length === 0 && (
                      <p className="text-sm text-slate-400 text-center py-8">אין תנועות עדיין. הזן תרומה ראשונה!</p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Supports Dashboard */}
          {currentTab === 'supports_dashboard' && (
            <div className="space-y-8 animate-fadeIn">
              <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                  <h2 className="text-2xl font-black text-slate-900">מרכז בקרת תמיכות ונתמכים</h2>
                  <p className="text-slate-500">סקירת מצב הבקשות, שיעורי אישור, פילוח ותשלומים בפועל</p>
                </div>
                <button
                  onClick={() => setCurrentTab('distribution')}
                  className="flex items-center px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl shadow font-semibold transition"
                >
                  לתכנון חלוקה פעיל ←
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
                  <p className="text-sm font-semibold text-slate-400">סה"כ בקשות שהוגשו</p>
                  <h3 className="text-3xl font-black text-slate-900 mt-2">{C}{requests.reduce((s, r) => s + r.amountRequested, 0).toLocaleString()}</h3>
                  <p className="text-xs text-slate-500 mt-1">{requests.length} בקשות במערכת</p>
                </div>
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
                  <p className="text-sm font-semibold text-slate-400">סכום מאושר לחלוקה</p>
                  <h3 className="text-3xl font-black text-indigo-600 mt-2">{C}{requests.filter(r => r.status === 'אושר' || r.status === 'שולם').reduce((s, r) => s + r.amountApproved, 0).toLocaleString()}</h3>
                  <p className="text-xs text-indigo-500 mt-1">
                    שיעור אישור: {requests.length > 0 ? Math.round((requests.filter(r => r.status === 'אושר' || r.status === 'שולם').reduce((s, r) => s + r.amountApproved, 0) / Math.max(1, requests.reduce((s, r) => s + r.amountRequested, 0))) * 100) : 0}%
                  </p>
                </div>
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
                  <p className="text-sm font-semibold text-slate-400">שולם והועבר בפועל</p>
                  <h3 className="text-3xl font-black text-emerald-600 mt-2">{C}{requests.filter(r => r.status === 'שולם').reduce((s, r) => s + r.amountApproved, 0).toLocaleString()}</h3>
                  <p className="text-xs text-emerald-600 mt-1">מתוך התקציב המאושר</p>
                </div>
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
                  <p className="text-sm font-semibold text-slate-400">בקשות ממתינות לאישור</p>
                  <h3 className="text-3xl font-black text-amber-600 mt-2">{requests.filter(r => r.status === 'בהמתנה').length}</h3>
                  <p className="text-xs text-amber-500 mt-1">נדרש תכנון חלוקה</p>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
                  <h3 className="font-extrabold text-slate-900 mb-4">פילוח תקציב מאושר לפי קטגוריית סיוע</h3>
                  <div className="space-y-4">
                    {SUPPORT_CATEGORIES.map(cat => {
                      const approvedSum = requests
                        .filter(r => r.category === cat && (r.status === 'אושר' || r.status === 'שולם'))
                        .reduce((s, r) => s + r.amountApproved, 0);
                      const totalApproved = requests
                        .filter(r => r.status === 'אושר' || r.status === 'שולם')
                        .reduce((s, r) => s + r.amountApproved, 0);
                      const percent = totalApproved > 0 ? Math.round((approvedSum / totalApproved) * 100) : 0;
                      return (
                        <div key={cat} className="space-y-1">
                          <div className="flex justify-between text-xs font-bold text-slate-600">
                            <span>{cat}</span>
                            <span>{C}{approvedSum.toLocaleString()} ({percent}%)</span>
                          </div>
                          <div className="w-full bg-slate-100 h-3 rounded-full overflow-hidden">
                            <div className="bg-indigo-500 h-full rounded-full" style={{ width: `${percent}%` }}></div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
                  <h3 className="font-extrabold text-slate-900 mb-4">פילוח תמיכה לפי אזור גיאוגרפי</h3>
                  <div className="space-y-4">
                    {Array.from(new Set(recipients.map(r => r.address))).map(city => {
                      const cityRecipients = recipients.filter(r => r.address === city).map(r => r.id);
                      const approvedSum = requests
                        .filter(r => cityRecipients.includes(r.recipientId) && (r.status === 'אושר' || r.status === 'שולם'))
                        .reduce((s, r) => s + r.amountApproved, 0);
                      const totalApproved = requests
                        .filter(r => r.status === 'אושר' || r.status === 'שולם')
                        .reduce((s, r) => s + r.amountApproved, 0);
                      const percent = totalApproved > 0 ? Math.round((approvedSum / totalApproved) * 100) : 0;
                      return (
                        <div key={city} className="space-y-1">
                          <div className="flex justify-between text-xs font-bold text-slate-600">
                            <span>{city}</span>
                            <span>{C}{approvedSum.toLocaleString()} ({percent}%)</span>
                          </div>
                          <div className="w-full bg-slate-100 h-3 rounded-full overflow-hidden">
                            <div className="bg-indigo-500 h-full rounded-full" style={{ width: `${percent}%` }}></div>
                          </div>
                        </div>
                      );
                    })}
                    {recipients.length === 0 && <p className="text-sm text-slate-400 text-center py-4">אין נתמכים עדיין.</p>}
                  </div>
                </div>
              </div>

              <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
                <h3 className="font-extrabold text-slate-900 mb-2">מרכז העברת כספים לנתמכים</h3>
                <p className="text-sm text-slate-400 mb-4">להלן התמיכות שאושרו וממתינות להעברה. סמן "בצע העברה" כדי לעדכן את התזרים.</p>
                <div className="overflow-hidden rounded-xl border border-slate-100">
                  <table className="w-full text-right border-collapse">
                    <thead>
                      <tr className="bg-slate-50 text-slate-400 text-xs font-bold border-b border-slate-200">
                        <th className="p-4">משפחה נתמכת</th>
                        <th className="p-4">קטגוריה</th>
                        <th className="p-4">סכום מאושר</th>
                        <th className="p-4">סטטוס</th>
                        <th className="p-4 text-left">פעולה</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-sm">
                      {requests.filter(r => r.status === 'אושר' || r.status === 'שולם').map(req => {
                        const recipient = recipients.find(rec => rec.id === req.recipientId);
                        return (
                          <tr key={req.id} className="hover:bg-slate-50/50 transition">
                            <td className="p-4">
                              <p className="font-bold text-slate-950">{recipient ? recipient.name : 'נתמך'}</p>
                              <p className="text-xs text-slate-400">{recipient ? `נפשות: ${recipient.familySize} | ${recipient.address}` : ''}</p>
                            </td>
                            <td className="p-4">
                              <span className="px-2 py-0.5 text-xs rounded font-semibold bg-slate-100 text-slate-700">{req.category || '—'}</span>
                            </td>
                            <td className="p-4 font-black text-indigo-600 text-base">{C}{req.amountApproved.toLocaleString()}</td>
                            <td className="p-4">
                              <span className={`px-2.5 py-1 text-xs rounded-full font-bold ${req.status === 'שולם' ? 'bg-emerald-100 text-emerald-800' : 'bg-indigo-100 text-indigo-800'}`}>
                                {req.status === 'שולם' ? '✓ שולם והועבר' : '⏳ ממתין להעברה'}
                              </span>
                            </td>
                            <td className="p-4 text-left">
                              {req.status === 'אושר' ? (
                                <button onClick={() => handleMarkAsPaid(req.id)} className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg transition shadow-sm">
                                  בצע העברה בנקאית
                                </button>
                              ) : (
                                <span className="text-xs text-slate-400 font-medium">הושלם בהצלחה</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                      {requests.filter(r => r.status === 'אושר' || r.status === 'שולם').length === 0 && (
                        <tr><td colSpan="5" className="p-8 text-center text-slate-400">אין תמיכות מאושרות כרגע. גש ל"מתכנן חלוקה" כדי לאשר תמיכות.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* Donors */}
          {currentTab === 'donors' && (
            <div className="space-y-6 animate-fadeIn">
              <div className="flex justify-between items-center">
                <div>
                  <h2 className="text-2xl font-black text-slate-900">ניהול פנקס תורמים</h2>
                  <p className="text-slate-500">תצוגת תורמים, שיוך מתרימים והיסטוריית תרומות</p>
                </div>
                <button onClick={() => setShowAddDonorModal(true)} className="flex items-center px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-semibold transition shadow-sm">
                  <Icons.Plus /> תורם חדש
                </button>
              </div>

              {currentRole === 'Fundraiser' && (
                <div className="bg-indigo-50 border-r-4 border-indigo-500 p-3 rounded-lg text-sm text-indigo-800">
                  ⚠️ <strong>מצב מתרים פעיל:</strong> מוצגים עבורך אך ורק תורמים המשויכים אליך.
                </div>
              )}

              {currentRole === 'Committee' && !committeeApprovedAccess && (
                <div className="bg-amber-50 border border-amber-200 p-5 rounded-2xl flex flex-col items-center text-center max-w-xl mx-auto space-y-4">
                  <Icons.Lock />
                  <h3 className="font-extrabold text-slate-800">גישה מוגבלת לחבר ועד</h3>
                  <p className="text-sm text-slate-500">על פי תקנון אבטחת המידע, פרטי תורמים גלויים רק למתרימים ולצוות הניהול. ניתן לבקש הרשאת צפייה מיוחדת.</p>
                  <button onClick={handleRequestCommitteeAccess} disabled={requestingCommitteeAccess} className="px-5 py-2.5 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-xl shadow transition disabled:bg-slate-300">
                    {requestingCommitteeAccess ? 'מגיש בקשה למנהל...' : 'בקש אישור גישה זמני'}
                  </button>
                </div>
              )}

              {(currentRole !== 'Committee' || committeeApprovedAccess) && (
                <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
                  <table className="w-full text-right border-collapse">
                    <thead>
                      <tr className="bg-slate-50 text-slate-400 text-xs font-bold border-b border-slate-200">
                        <th className="p-4">שם התורם</th>
                        <th className="p-4">אימייל וטלפון</th>
                        <th className="p-4">עיר</th>
                        <th className="p-4">מתרים אחראי</th>
                        <th className="p-4 text-left">סה"כ נתרם</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-sm">
                      {visibleDonors.map(donor => (
                        <tr key={donor.id} className="hover:bg-slate-50/50 transition">
                          <td className="p-4 font-bold text-slate-950">{donor.name}</td>
                          <td className="p-4">
                            <div className="text-slate-800 font-medium">{donor.email}</div>
                            <div className="text-xs text-slate-400">{donor.phone}</div>
                          </td>
                          <td className="p-4 text-slate-500">{donor.city}</td>
                          <td className="p-4">
                            <select
                              value={donor.assignedFundraiserId}
                              onChange={(e) => handleAssignFundraiser(donor.id, e.target.value)}
                              className="text-xs font-bold bg-indigo-50/80 border border-indigo-100 text-indigo-800 rounded p-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-400 transition"
                            >
                              {fundraisers.map(fund => (
                                <option key={fund.id} value={fund.id}>👤 {fund.name}</option>
                              ))}
                            </select>
                          </td>
                          <td className="p-4 text-left font-black text-emerald-600 text-base">{C}{donor.totalDonated.toLocaleString()}</td>
                        </tr>
                      ))}
                      {visibleDonors.length === 0 && (
                        <tr><td colSpan="5" className="p-8 text-center text-slate-400">אין תורמים עדיין. הוסף תורם ראשון!</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Fundraisers */}
          {currentTab === 'fundraisers' && (
            <div className="space-y-6 animate-fadeIn">
              <div className="flex justify-between items-center">
                <div>
                  <h2 className="text-2xl font-black text-slate-900">מתרימים ויעדי גיוס</h2>
                  <p className="text-slate-500">ניהול צוות מגייסי הכספים ושיוך תורמים</p>
                </div>
                <button onClick={() => setShowAddFundraiserModal(true)} className="flex items-center px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-semibold transition shadow-sm">
                  <Icons.Plus /> מתרים חדש
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
                  <p className="text-xs font-bold text-slate-400 uppercase">צוות פעיל</p>
                  <h3 className="text-3xl font-black text-slate-900 mt-1">{fundraisers.length} מתרימים</h3>
                  <p className="text-xs text-slate-500 mt-1.5">מובילים את הקשר מול התורמים</p>
                </div>
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
                  <p className="text-xs font-bold text-slate-400 uppercase">סה"כ יעד גיוס</p>
                  <h3 className="text-3xl font-black text-slate-900 mt-1">{C}{fundraisers.reduce((s, f) => s + f.target, 0).toLocaleString()}</h3>
                  <p className="text-xs text-indigo-600 mt-1.5 font-bold">גויס בפועל: {C}{donors.reduce((s, d) => s + d.totalDonated, 0).toLocaleString()}</p>
                </div>
                <div className="bg-white p-6 rounded-2xl shadow-sm border bg-gradient-to-br from-indigo-50 to-white border-indigo-100">
                  <p className="text-xs font-bold text-indigo-400 uppercase">שיוך ומיקוד</p>
                  <h3 className="text-2xl font-black text-indigo-900 mt-1">
                    {donors.filter(d => !d.assignedFundraiserId).length === 0 ? 'כל התורמים משויכים' : `${donors.filter(d => !d.assignedFundraiserId).length} ללא שיוך`}
                  </h3>
                  <p className="text-xs text-slate-500 mt-1.5">מומלץ לשייך לכל תורם מגייס אישי</p>
                </div>
              </div>

              <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                <h3 className="font-extrabold text-slate-900 text-lg">שיוך מהיר של תורמים למתרימים</h3>
                <form onSubmit={(e) => {
                  e.preventDefault();
                  const fd = new FormData(e.target);
                  handleAssignFundraiser(fd.get('donorId'), fd.get('fundraiserId'));
                }} className="flex flex-wrap items-end gap-4 text-sm bg-slate-50 p-4 rounded-xl border border-slate-100">
                  <div className="flex-1 min-w-[200px]">
                    <label className="block text-xs font-bold text-slate-500 mb-1">בחר תורם:</label>
                    <select name="donorId" required className="w-full border border-slate-200 rounded-lg p-2 bg-white">
                      {donors.map(d => (
                        <option key={d.id} value={d.id}>{d.name} ({d.city}) - אצל {fundraisers.find(f => f.id === d.assignedFundraiserId)?.name || 'ללא שיוך'}</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex-1 min-w-[200px]">
                    <label className="block text-xs font-bold text-slate-500 mb-1">שייך למתרים:</label>
                    <select name="fundraiserId" required className="w-full border border-slate-200 rounded-lg p-2 bg-white">
                      {fundraisers.map(f => (<option key={f.id} value={f.id}>{f.name} ({f.phone})</option>))}
                    </select>
                  </div>
                  <button type="submit" className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-lg shadow-sm transition">בצע שיוך</button>
                </form>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {fundraisers.map(fund => {
                  const assignedDonors = donors.filter(d => d.assignedFundraiserId === fund.id);
                  const totalRaised = assignedDonors.reduce((s, d) => s + d.totalDonated, 0);
                  const progressPercent = Math.min(100, Math.round((totalRaised / Math.max(1, fund.target)) * 100));
                  return (
                    <div key={fund.id} className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-between hover:border-indigo-400 transition-all duration-200">
                      <div>
                        <div className="flex justify-between items-start mb-3">
                          <span className="px-2 py-0.5 text-xs bg-indigo-50 text-indigo-700 font-bold rounded">מתרים פעיל</span>
                        </div>
                        <h3 className="font-extrabold text-lg text-slate-900">{fund.name}</h3>
                        <p className="text-xs text-slate-500 mt-0.5">{fund.email} • {fund.phone}</p>
                        <div className="space-y-2 mt-5">
                          <div className="flex justify-between text-xs font-bold text-slate-500">
                            <span>יעד: {C}{fund.target.toLocaleString()}</span>
                            <span>{progressPercent}%</span>
                          </div>
                          <div className="w-full bg-slate-100 h-2.5 rounded-full overflow-hidden">
                            <div className="bg-indigo-600 h-full rounded-full transition-all duration-300" style={{ width: `${progressPercent}%` }}></div>
                          </div>
                        </div>
                      </div>
                      <div className="mt-6 pt-4 border-t border-slate-100 flex justify-between items-center bg-slate-50 -mx-6 -mb-6 p-4 rounded-b-2xl">
                        <div>
                          <p className="text-[10px] text-slate-400 uppercase font-bold">גויס בפועל</p>
                          <p className="font-black text-emerald-600 text-base">{C}{totalRaised.toLocaleString()}</p>
                        </div>
                        <div className="text-left">
                          <p className="text-[10px] text-slate-400 uppercase font-bold">תורמים משויכים</p>
                          <p className="font-bold text-slate-700 text-sm">{assignedDonors.length} תורמים</p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Donations */}
          {currentTab === 'donations' && (
            <div className="space-y-6">
              <div className="flex justify-between items-center">
                <div>
                  <h2 className="text-2xl font-black text-slate-900">מעקב תרומות בזמן אמת</h2>
                  <p className="text-slate-500">תרומות דרך Stripe, יבוא בנק או הזנה ידנית</p>
                </div>
                <div className="flex space-x-3 space-x-reverse">
                  <button onClick={() => setShowOnlineDonationModal(true)} className="flex items-center px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-semibold transition shadow-sm">
                    💳 תרומה אונליין (Stripe)
                  </button>
                  <button onClick={() => setShowAddDonationModal(true)} className="flex items-center px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-semibold transition shadow-sm">
                    <Icons.Plus /> הזנת תרומה
                  </button>
                </div>
              </div>

              <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
                <table className="w-full text-right border-collapse">
                  <thead>
                    <tr className="bg-slate-50 text-slate-400 text-xs font-bold border-b border-slate-200">
                      <th className="p-4">תורם</th>
                      <th className="p-4">סכום</th>
                      <th className="p-4">מגבית</th>
                      <th className="p-4">מקור</th>
                      <th className="p-4">תאריך</th>
                      <th className="p-4">סטטוס</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-sm">
                    {donations.map(don => {
                      const donor = donors.find(d => d.id === don.donorId);
                      const campaign = campaigns.find(c => c.id === don.campaignId);
                      return (
                        <tr key={don.id} className="hover:bg-slate-50/50 transition">
                          <td className="p-4">
                            <p className="font-bold text-slate-900">{donor ? donor.name : 'תורם אנונימי'}</p>
                            <p className="text-xs text-slate-400">{donor ? donor.email : ''}</p>
                          </td>
                          <td className="p-4 font-black text-slate-900 text-base">{C}{don.amount.toLocaleString()}</td>
                          <td className="p-4">
                            <span className="px-2.5 py-1 text-xs bg-slate-100 text-slate-700 rounded-lg font-semibold">{campaign ? campaign.name : 'כללי'}</span>
                          </td>
                          <td className="p-4 font-medium text-slate-600">
                            {don.source === 'Stripe' ? (
                              <span className="inline-flex items-center text-indigo-600"><span className="w-2 h-2 bg-indigo-500 rounded-full ml-1.5"></span> Stripe</span>
                            ) : don.source === 'בנק' ? (
                              <span className="inline-flex items-center text-emerald-600"><span className="w-2 h-2 bg-emerald-500 rounded-full ml-1.5"></span> יבוא מהבנק</span>
                            ) : don.source === 'הו"ק' ? (
                              <span className="inline-flex items-center text-purple-600"><span className="w-2 h-2 bg-purple-500 rounded-full ml-1.5"></span> הוראת קבע</span>
                            ) : (
                              <span className="inline-flex items-center text-slate-600"><span className="w-2 h-2 bg-slate-400 rounded-full ml-1.5"></span> קבלה ידנית</span>
                            )}
                          </td>
                          <td className="p-4 text-slate-500">{don.date}</td>
                          <td className="p-4"><span className="px-2 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800">{don.status}</span></td>
                        </tr>
                      );
                    })}
                    {donations.length === 0 && (
                      <tr><td colSpan="6" className="p-8 text-center text-slate-400">אין תרומות עדיין. לחץ "הזנת תרומה" כדי להתחיל.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Pledges (הו"ק) */}
          {currentTab === 'pledges' && (
            <div className="space-y-6 animate-fadeIn">
              <div className="flex justify-between items-center">
                <div>
                  <h2 className="text-2xl font-black text-slate-900">התחייבויות תורמים (הוראות קבע)</h2>
                  <p className="text-slate-500">מעקב אחר תורמים המתחייבים לסכום חודשי קבוע, ומי שטרם שילם החודש</p>
                </div>
                <div className="flex space-x-3 space-x-reverse">
                  <button onClick={handleExportPledges} disabled={pledges.length === 0} className="flex items-center px-4 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-xl font-semibold transition shadow-sm disabled:opacity-50">
                    📥 ייצוא לאקסל
                  </button>
                  <button onClick={() => setShowAddPledgeModal(true)} disabled={donors.length === 0} className="flex items-center px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-semibold transition shadow-sm disabled:bg-slate-300">
                    <Icons.Plus /> התחייבות חדשה
                  </button>
                </div>
              </div>

              {/* כרטיסי סיכום */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
                  <p className="text-sm font-semibold text-slate-400">התחייבויות פעילות</p>
                  <h3 className="text-3xl font-black text-slate-900 mt-2">{pledgeStats.activeCount}</h3>
                  <p className="text-xs text-slate-500 mt-1">תורמים בהוראת קבע</p>
                </div>
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
                  <p className="text-sm font-semibold text-slate-400">התחייבות חודשית כוללת</p>
                  <h3 className="text-3xl font-black text-indigo-600 mt-2">{C}{pledgeStats.monthlyCommitted.toLocaleString()}</h3>
                  <p className="text-xs text-indigo-500 mt-1">צפי הכנסה חודשי קבוע</p>
                </div>
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
                  <p className="text-sm font-semibold text-slate-400">נגבה החודש מהו"ק</p>
                  <h3 className="text-3xl font-black text-emerald-600 mt-2">{C}{pledgeStats.collectedThisMonth.toLocaleString()}</h3>
                  <p className="text-xs text-emerald-600 mt-1">מתוך {C}{pledgeStats.monthlyCommitted.toLocaleString()} צפוי</p>
                </div>
                <div className={`p-6 rounded-2xl shadow-sm border ${pledgeStats.unpaid.length > 0 ? 'bg-rose-50 border-rose-200' : 'bg-emerald-50/50 border-emerald-200'}`}>
                  <p className="text-sm font-semibold text-slate-500">לא שילמו החודש</p>
                  <h3 className={`text-3xl font-black mt-2 ${pledgeStats.unpaid.length > 0 ? 'text-rose-700' : 'text-emerald-700'}`}>{pledgeStats.unpaid.length}</h3>
                  <p className="text-xs text-slate-600 mt-1">{pledgeStats.unpaid.length > 0 ? 'דורש מעקב וגבייה' : 'הכל שולם — מצוין!'}</p>
                </div>
              </div>

              {/* התראת פיגור */}
              {pledgeStats.unpaid.length > 0 && (
                <div className="bg-rose-50 border-r-4 border-rose-500 p-4 rounded-xl shadow-sm">
                  <div className="flex items-start space-x-3 space-x-reverse">
                    <Icons.Alert />
                    <div className="flex-1">
                      <h4 className="font-bold text-rose-800">תורמים שטרם שילמו את ההתחייבות החודש:</h4>
                      <div className="flex flex-wrap gap-2 mt-2">
                        {pledgeStats.unpaid.map(p => {
                          const donor = donors.find(d => d.id === p.donorId);
                          return (
                            <span key={p.id} className="inline-flex items-center gap-2 bg-white border border-rose-200 text-rose-700 px-3 py-1 rounded-lg text-sm font-bold">
                              {donor?.name || 'תורם'} · {C}{p.amount.toLocaleString()}
                              <button onClick={() => setPayingPledge(p)} className="text-xs bg-emerald-600 hover:bg-emerald-700 text-white px-2 py-0.5 rounded font-bold transition">רשום תשלום</button>
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* הערה על אוטומציה */}
              <div className="bg-indigo-50 border border-indigo-100 p-3 rounded-xl text-xs text-indigo-800">
                💡 תשלום בבנק/מזומן נרשם ידנית ("רשום תשלום") ומסתנכרן מיד לתורם, למגבית ולתזרים. לאחר חיבור Stripe — תשלומי אשראי ייגבו ויירשמו אוטומטית.
              </div>

              {/* טבלת התחייבויות */}
              <div className="bg-white rounded-2xl border border-slate-200 overflow-x-auto shadow-sm">
                <table className="w-full text-right border-collapse min-w-[860px]">
                  <thead>
                    <tr className="bg-slate-50 text-slate-400 text-xs font-bold border-b border-slate-200">
                      <th className="p-4">תורם</th>
                      <th className="p-4">סכום חודשי</th>
                      <th className="p-4">אופן תשלום</th>
                      <th className="p-4">החודש</th>
                      <th className="p-4">פיגור</th>
                      <th className="p-4">סה"כ שולם</th>
                      <th className="p-4">אחוז גבייה</th>
                      <th className="p-4 text-left">פעולות</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-sm">
                    {pledgeStats.rows.map(p => {
                      const donor = donors.find(d => d.id === p.donorId);
                      return (
                        <tr key={p.id} className="hover:bg-slate-50/50 transition">
                          <td className="p-4">
                            <div className="flex items-center gap-2">
                              <p className="font-bold text-slate-900">{donor?.name || 'תורם'}</p>
                              <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${p.status === 'active' ? 'bg-indigo-50 text-indigo-700' : p.status === 'paused' ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-500'}`}>
                                {p.status === 'active' ? 'פעילה' : p.status === 'paused' ? 'מושהית' : 'בוטלה'}
                              </span>
                            </div>
                            <p className="text-xs text-slate-400">{donor?.phone || ''}</p>
                          </td>
                          <td className="p-4 font-black text-slate-900">{C}{p.amount.toLocaleString()}<span className="block text-[10px] font-normal text-slate-400">{p.billingDay} בחודש</span></td>
                          <td className="p-4">
                            <span className="px-2 py-0.5 rounded text-xs font-semibold bg-slate-100 text-slate-700">{methodLabel(p.method)}</span>
                          </td>
                          <td className="p-4">
                            {p.status !== 'active' ? (
                              <span className="text-xs text-slate-400">—</span>
                            ) : p.paidThisMonth ? (
                              <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800">✓ שולם</span>
                            ) : (
                              <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-rose-100 text-rose-800">✗ לא שולם</span>
                            )}
                          </td>
                          <td className="p-4">
                            {p.missedMonths > 0 ? (
                              <span className="px-2 py-0.5 rounded text-xs font-bold bg-rose-100 text-rose-800">{p.missedMonths} חודשים</span>
                            ) : (
                              <span className="text-xs text-slate-400">ללא</span>
                            )}
                          </td>
                          <td className="p-4 font-bold text-emerald-600">{C}{p.totalPaid.toLocaleString()}</td>
                          <td className="p-4">
                            <div className="flex items-center gap-2">
                              <div className="w-16 bg-slate-100 h-2 rounded-full overflow-hidden">
                                <div className={`h-full rounded-full ${p.collectionPct >= 80 ? 'bg-emerald-500' : p.collectionPct >= 50 ? 'bg-amber-500' : 'bg-rose-500'}`} style={{ width: `${Math.min(100, p.collectionPct)}%` }}></div>
                              </div>
                              <span className="text-xs font-bold text-slate-600">{p.collectionPct}%</span>
                            </div>
                          </td>
                          <td className="p-4 text-left space-x-1.5 space-x-reverse whitespace-nowrap">
                            <button onClick={() => setHistoryPledge(p)} className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-lg transition">היסטוריה</button>
                            {p.status === 'active' && (
                              <button onClick={() => setPayingPledge(p)} className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg transition">רשום תשלום</button>
                            )}
                            {p.status === 'active' ? (
                              <button onClick={() => handleSetPledgeStatus(p.id, 'paused')} className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-lg transition">השהה</button>
                            ) : p.status === 'paused' ? (
                              <button onClick={() => handleSetPledgeStatus(p.id, 'active')} className="px-2.5 py-1 bg-indigo-100 hover:bg-indigo-200 text-indigo-700 text-xs font-bold rounded-lg transition">הפעל</button>
                            ) : null}
                          </td>
                        </tr>
                      );
                    })}
                    {pledgeStats.rows.length === 0 && (
                      <tr><td colSpan="8" className="p-8 text-center text-slate-400">אין התחייבויות עדיין. לחץ "התחייבות חדשה" כדי לרשום הוראת קבע ראשונה.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Campaigns */}
          {currentTab === 'campaigns' && (
            <div className="space-y-6 animate-fadeIn">
              <div className="flex justify-between items-center">
                <div>
                  <h2 className="text-2xl font-black text-slate-900">ניהול מגביות וקרנות</h2>
                  <p className="text-slate-500">קמפיינים פעילים, יעדים וביצועים</p>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {campaigns.map(camp => {
                  const percent = Math.min(100, Math.round((camp.raised / Math.max(1, camp.target)) * 100));
                  return (
                    <div key={camp.id} className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-between">
                      <div>
                        <div className="flex justify-between items-start mb-3">
                          <span className="px-2.5 py-1 text-xs bg-slate-100 text-slate-600 rounded-md font-bold">{camp.category}</span>
                        </div>
                        <h3 className="font-extrabold text-lg text-slate-900 mb-4">{camp.name}</h3>
                        <div className="space-y-2">
                          <div className="flex justify-between text-xs font-bold text-slate-500">
                            <span>יעד: {C}{camp.target.toLocaleString()}</span>
                            <span>{percent}%</span>
                          </div>
                          <div className="w-full bg-slate-100 h-2.5 rounded-full overflow-hidden">
                            <div className="bg-indigo-600 h-full rounded-full transition-all duration-500" style={{ width: `${percent}%` }}></div>
                          </div>
                        </div>
                      </div>
                      <div className="mt-6 pt-4 border-t border-slate-100 flex justify-between items-center">
                        <div>
                          <p className="text-xs text-slate-400">גויס בפועל</p>
                          <p className="font-black text-emerald-600 text-lg">{C}{camp.raised.toLocaleString()}</p>
                        </div>
                        <button onClick={() => { setSelectedDonorId(''); setDonorSearchText(''); setShowDonorDropdown(false); setShowAddDonationModal(true); }} className="px-3.5 py-1.5 bg-slate-50 text-slate-700 hover:bg-slate-100 font-bold text-xs rounded-xl transition">שייך תרומה</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Recipients */}
          {currentTab === 'recipients' && (
            <div className="space-y-6 animate-fadeIn">
              <div className="flex justify-between items-center">
                <div>
                  <h2 className="text-2xl font-black text-slate-900">נתמכים ובקשות תמיכה</h2>
                  <p className="text-slate-500">ניהול משפחות נתמכות והגשת בקשות</p>
                </div>
                <div className="flex space-x-3 space-x-reverse">
                  <button onClick={() => setShowAddRecipientModal(true)} className="flex items-center px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-semibold transition shadow-sm">
                    <Icons.Plus /> נתמך חדש
                  </button>
                  <button onClick={() => setShowAddRequestModal(true)} disabled={recipients.length === 0} className="flex items-center px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-semibold transition shadow-sm disabled:bg-slate-300">
                    <Icons.Plus /> הגש בקשת תמיכה
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm lg:col-span-1">
                  <h3 className="font-extrabold text-slate-900 mb-4">משפחות רשומות</h3>
                  <div className="space-y-3">
                    {recipients.map(rec => (
                      <div key={rec.id} className="p-3 bg-slate-50 rounded-xl hover:bg-slate-100 transition border border-slate-100">
                        <div className="flex justify-between">
                          <span className="font-bold text-slate-900">{rec.name}</span>
                          <span className="text-xs font-semibold px-2 py-0.5 rounded bg-emerald-100 text-emerald-800">{rec.status}</span>
                        </div>
                        <div className="flex justify-between items-center mt-2 text-xs text-slate-500">
                          <span>נפשות: {rec.familySize}</span>
                          <span>מיקום: {rec.address}</span>
                        </div>
                        <div className="mt-2 pt-2 border-t border-slate-200/50 flex justify-between items-center">
                          <span className="text-xs font-semibold text-indigo-600">ציון עדיפות:</span>
                          <span className="text-xs font-bold px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700">{rec.priorityScore}/100</span>
                        </div>
                      </div>
                    ))}
                    {recipients.length === 0 && <p className="text-sm text-slate-400 text-center py-8">אין נתמכים. הוסף משפחה ראשונה!</p>}
                  </div>
                </div>

                <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm lg:col-span-2">
                  <h3 className="font-extrabold text-slate-900 mb-4">בקשות תמיכה</h3>
                  <div className="space-y-4">
                    {requests.map(req => {
                      const recipient = recipients.find(r => r.id === req.recipientId);
                      return (
                        <div key={req.id} className="p-4 border border-slate-100 hover:border-slate-300 rounded-xl transition flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                          <div>
                            <p className="font-bold text-slate-900">{recipient ? recipient.name : 'נתמך לא ידוע'}</p>
                            <p className="text-xs text-slate-400 mt-1">
                              קטגוריה: <span className="font-bold text-slate-700">{req.category || '—'}</span> • סכום מבוקש: <span className="font-bold text-slate-700">{C}{req.amountRequested.toLocaleString()}</span> • עדיפות: <span className={`font-semibold ${req.priority === 'קריטית' ? 'text-red-600' : 'text-amber-600'}`}>{req.priority}</span>
                            </p>
                          </div>
                          <div className="flex items-center space-x-3 space-x-reverse">
                            <div className="text-left pl-3 ml-3 border-l border-slate-200">
                              <p className="text-xs text-slate-400">מאושר לחלוקה</p>
                              <p className="font-black text-slate-900 text-base">{req.amountApproved > 0 ? `${C}${req.amountApproved.toLocaleString()}` : 'טרם הוקצה'}</p>
                            </div>
                            <span className={`px-2.5 py-1 text-xs rounded-full font-bold ${req.status === 'בהמתנה' ? 'bg-yellow-100 text-yellow-800' : req.status === 'אושר' ? 'bg-indigo-100 text-indigo-800' : req.status === 'שולם' ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'}`}>{req.status}</span>
                          </div>
                        </div>
                      );
                    })}
                    {requests.length === 0 && <p className="text-sm text-slate-400 text-center py-8">אין בקשות עדיין.</p>}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Distribution */}
          {currentTab === 'distribution' && (
            <div className="space-y-6 animate-fadeIn">
              <div className="bg-slate-900 text-white p-6 rounded-3xl shadow-lg border border-slate-800">
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-slate-800 pb-4">
                  <div>
                    <span className="text-xs font-bold text-emerald-400 tracking-wider uppercase">מנוע חלוקה ואיזון קופה</span>
                    <h2 className="text-2xl font-black mt-1">מערכת תכנון תמיכות</h2>
                    <p className="text-slate-400 text-sm mt-1">העובד מתאים את גובה הסיוע למגבלת התזרים הזמינה.</p>
                  </div>
                  <div className="bg-slate-800/80 p-4 rounded-2xl border border-slate-700/60">
                    <p className="text-xs text-slate-400">תקציב זמין לחלוקה</p>
                    <p className="text-2xl font-black text-emerald-400">{C}{stats.cashFlowBalance.toLocaleString()}</p>
                  </div>
                </div>
              </div>
              <DistributionSim requests={requests} recipients={recipients} availableBudget={stats.cashFlowBalance} onSave={handleSaveDistribution} currentRole={currentRole} />
            </div>
          )}

          {/* Expenses */}
          {currentTab === 'expenses' && (
            <div className="space-y-6">
              <div className="flex justify-between items-center">
                <div>
                  <h2 className="text-2xl font-black text-slate-900">ספר תזרים מזומנים והוצאות</h2>
                  <p className="text-slate-500">רישום הוצאות קבועות, משתנות וביצועיות</p>
                </div>
                <button onClick={() => setShowAddExpenseModal(true)} className="flex items-center px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl font-semibold transition shadow-sm">
                  <Icons.Plus /> הזנת הוצאה
                </button>
              </div>

              {/* פילוח תזרים חודשי */}
              <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm animate-fadeIn">
                <h3 className="font-extrabold text-slate-900 mb-4">תזרים חודשי — הכנסות מול הוצאות</h3>
                {monthlyFlow.length === 0 ? (
                  <p className="text-sm text-slate-400 text-center py-8">אין תנועות עדיין. הזן תרומות והוצאות כדי לראות את הפילוח החודשי.</p>
                ) : (
                  <>
                    {/* תרשים עמודות */}
                    <div className="h-56 w-full flex items-end justify-around gap-3 px-2 pt-4 border-b border-slate-200 overflow-x-auto">
                      {(() => {
                        const maxVal = Math.max(1, ...monthlyFlow.map(m => Math.max(m.income, m.expense, m.distribution)));
                        return monthlyFlow.map(m => (
                          <div key={m.key} className="flex flex-col items-center min-w-[64px] flex-1">
                            <div className="flex items-end justify-center gap-1 w-full h-40">
                              <div className="w-3.5 bg-emerald-500 rounded-t transition-all duration-500" style={{ height: `${(m.income / maxVal) * 100}%` }} title={`הכנסות: ${C}${m.income.toLocaleString()}`}></div>
                              <div className="w-3.5 bg-rose-500 rounded-t transition-all duration-500" style={{ height: `${(m.expense / maxVal) * 100}%` }} title={`הוצאות: ${C}${m.expense.toLocaleString()}`}></div>
                              <div className="w-3.5 bg-indigo-500 rounded-t transition-all duration-500" style={{ height: `${(m.distribution / maxVal) * 100}%` }} title={`תמיכות: ${C}${m.distribution.toLocaleString()}`}></div>
                            </div>
                            <span className="text-[10px] text-slate-500 mt-2 text-center whitespace-nowrap">{m.label}</span>
                          </div>
                        ));
                      })()}
                    </div>
                    <div className="flex justify-center space-x-6 space-x-reverse mt-3 text-xs">
                      <div className="flex items-center space-x-1.5 space-x-reverse"><span className="w-3 h-3 bg-emerald-500 rounded"></span><span>הכנסות</span></div>
                      <div className="flex items-center space-x-1.5 space-x-reverse"><span className="w-3 h-3 bg-rose-500 rounded"></span><span>הוצאות</span></div>
                      <div className="flex items-center space-x-1.5 space-x-reverse"><span className="w-3 h-3 bg-indigo-500 rounded"></span><span>תמיכות שחולקו</span></div>
                    </div>

                    {/* טבלת פירוט חודשי */}
                    <div className="overflow-x-auto mt-5">
                      <table className="w-full text-right border-collapse text-sm">
                        <thead>
                          <tr className="bg-slate-50 text-slate-400 text-xs font-bold border-b border-slate-200">
                            <th className="p-3">חודש</th>
                            <th className="p-3 text-left">הכנסות</th>
                            <th className="p-3 text-left">הוצאות</th>
                            <th className="p-3 text-left">תמיכות שחולקו</th>
                            <th className="p-3 text-left">תזרים נטו</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {monthlyFlow.map(m => (
                            <tr key={m.key} className="hover:bg-slate-50/50 transition">
                              <td className="p-3 font-bold text-slate-800">{m.label}</td>
                              <td className="p-3 text-left font-bold text-emerald-600">{C}{m.income.toLocaleString()}</td>
                              <td className="p-3 text-left font-bold text-rose-600">{C}{m.expense.toLocaleString()}</td>
                              <td className="p-3 text-left font-bold text-indigo-600">{C}{m.distribution.toLocaleString()}</td>
                              <td className={`p-3 text-left font-black ${m.net >= 0 ? 'text-slate-900' : 'text-rose-700'}`}>{C}{m.net.toLocaleString()}</td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr className="bg-slate-50 font-black border-t-2 border-slate-200">
                            <td className="p-3 text-slate-900">סה"כ</td>
                            <td className="p-3 text-left text-emerald-700">{C}{monthlyFlow.reduce((s, m) => s + m.income, 0).toLocaleString()}</td>
                            <td className="p-3 text-left text-rose-700">{C}{monthlyFlow.reduce((s, m) => s + m.expense, 0).toLocaleString()}</td>
                            <td className="p-3 text-left text-indigo-700">{C}{monthlyFlow.reduce((s, m) => s + m.distribution, 0).toLocaleString()}</td>
                            <td className="p-3 text-left text-slate-900">{C}{monthlyFlow.reduce((s, m) => s + m.net, 0).toLocaleString()}</td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </>
                )}
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 animate-fadeIn">
                <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm lg:col-span-1">
                  <h3 className="font-extrabold text-slate-900 mb-4">הרכב ההוצאות</h3>
                  <div className="space-y-4">
                    {[
                      { category: 'קבועה', label: 'שכירות ומנהלה', color: 'bg-rose-500' },
                      { category: 'ביצועית', label: 'פרסום ומגביות', color: 'bg-indigo-500' },
                      { category: 'משתנה', label: 'ספקים ועמלות', color: 'bg-amber-500' },
                    ].map((type, idx) => {
                      const totalType = expenses.filter(e => e.category === type.category).reduce((s, e) => s + e.amount, 0);
                      return (
                        <div key={idx} className="space-y-2">
                          <div className="flex justify-between text-sm font-bold text-slate-700">
                            <span>{type.label}</span>
                            <span>{C}{totalType.toLocaleString()}</span>
                          </div>
                          <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                            <div className={`${type.color} h-full rounded-full`} style={{ width: `${Math.min(100, (totalType / Math.max(1, stats.totalExpenses)) * 100)}%` }}></div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm lg:col-span-2">
                  <h3 className="font-extrabold text-slate-900 mb-4">רשימת הוצאות</h3>
                  <table className="w-full text-right border-collapse">
                    <thead>
                      <tr className="bg-slate-50 text-slate-400 text-xs font-bold border-b border-slate-200">
                        <th className="p-3">תיאור</th>
                        <th className="p-3">סוג</th>
                        <th className="p-3 text-left">סכום</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-sm">
                      {expenses.map(exp => (
                        <tr key={exp.id} className="hover:bg-slate-50/50 transition">
                          <td className="p-3 font-bold text-slate-800">{exp.title}</td>
                          <td className="p-3"><span className="px-2 py-0.5 text-xs bg-slate-100 text-slate-600 rounded">{exp.category}</span></td>
                          <td className="p-3 text-left font-black text-rose-600">{C}{exp.amount.toLocaleString()}</td>
                        </tr>
                      ))}
                      {expenses.length === 0 && (
                        <tr><td colSpan="3" className="p-8 text-center text-slate-400">אין הוצאות רשומות.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* Bank Import */}
          {currentTab === 'bank_import' && (
            <div className="space-y-6">
              <div className="flex justify-between items-center">
                <div>
                  <h2 className="text-2xl font-black text-slate-900">יבוא דפי בנק והתאמת תנועות</h2>
                  <p className="text-slate-500">העלה קובץ בנק לפענוח אוטומטי של הוצאות ותרומות</p>
                </div>
                {bankTransactions.length > 0 && (
                  <button onClick={handleCommitBankTransactions} className="flex items-center px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl shadow font-semibold transition">
                    <Icons.Check /> קלוט תנועות לתזרים
                  </button>
                )}
              </div>

              <div className="bg-white p-8 rounded-3xl border border-dashed border-slate-300 shadow-sm flex flex-col items-center text-center justify-center space-y-3">
                <Icons.Upload />
                <div className="max-w-md">
                  <p className="font-bold text-slate-800 text-lg">גרור קובץ CSV/Excel של הבנק לכאן</p>
                  <p className="text-sm text-slate-400 mt-1">או לחץ על הכפתור לבחירת קובץ. המערכת תבצע פענוח ושיוך חכם.</p>
                </div>
                <div className="flex space-x-3 space-x-reverse pt-2">
                  <button onClick={handleSimulateBankUpload} disabled={isProcessingBankFile} className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold rounded-xl shadow transition disabled:opacity-50">
                    {isProcessingBankFile ? 'מפענח ומנתח...' : 'העלה קובץ בנק'}
                  </button>
                  <button onClick={handleSimulateBankUpload} disabled={isProcessingBankFile} className="px-5 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-bold rounded-xl transition">
                    💡 טען קובץ דוגמה
                  </button>
                </div>
                {bankFileName && (
                  <p className="text-xs font-semibold text-emerald-600 bg-emerald-50 px-3 py-1 rounded-full border border-emerald-200">קובץ טעון: {bankFileName}</p>
                )}
              </div>

              {bankTransactions.length > 0 && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 animate-fadeIn">
                  <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                    <div className="border-b border-slate-100 pb-3 flex justify-between items-center">
                      <h3 className="font-black text-slate-900 text-lg flex items-center space-x-2 space-x-reverse">
                        <span className="w-2.5 h-2.5 bg-emerald-500 rounded-full"></span>
                        <span>תקבולים שזוהו ({bankTransactions.filter(tx => tx.type === 'deposit').length})</span>
                      </h3>
                    </div>
                    <div className="space-y-4">
                      {bankTransactions.filter(tx => tx.type === 'deposit').map(tx => (
                        <div key={tx.id} className="p-4 bg-slate-50 border border-slate-100 rounded-xl space-y-3">
                          <div className="flex justify-between items-start">
                            <div>
                              <p className="text-xs text-slate-400 font-bold">{tx.date}</p>
                              <p className="font-bold text-slate-800 text-sm mt-0.5">{tx.desc}</p>
                            </div>
                            <span className="text-emerald-600 font-extrabold text-base">{C}{tx.amount.toLocaleString()}</span>
                          </div>
                          <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 pt-2 border-t border-slate-200/50">
                            <div className="flex items-center space-x-2 space-x-reverse">
                              <span className="text-xs font-bold text-slate-400">התאמת תורם:</span>
                              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${tx.confidence >= 80 ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>{tx.confidence}% התאמה</span>
                            </div>
                            <div className="min-w-[180px]">
                              <select value={tx.selectedDonorId} onChange={(e) => handleUpdateTxDonor(tx.id, e.target.value)} className="w-full text-xs font-bold bg-white border border-slate-200 rounded p-1">
                                {donors.map(d => (<option key={d.id} value={d.id}>{d.name} ({d.city})</option>))}
                              </select>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                    <div className="border-b border-slate-100 pb-3 flex justify-between items-center">
                      <h3 className="font-black text-slate-900 text-lg flex items-center space-x-2 space-x-reverse">
                        <span className="w-2.5 h-2.5 bg-rose-500 rounded-full"></span>
                        <span>חיובים שזוהו ({bankTransactions.filter(tx => tx.type === 'withdrawal').length})</span>
                      </h3>
                    </div>
                    <div className="space-y-4">
                      {bankTransactions.filter(tx => tx.type === 'withdrawal').map(tx => (
                        <div key={tx.id} className="p-4 bg-slate-50 border border-slate-100 rounded-xl space-y-3">
                          <div className="flex justify-between items-start">
                            <div>
                              <p className="text-xs text-slate-400 font-bold">{tx.date}</p>
                              <p className="font-bold text-slate-800 text-sm mt-0.5">{tx.desc}</p>
                            </div>
                            <span className="text-rose-600 font-extrabold text-base">{C}{tx.amount.toLocaleString()}</span>
                          </div>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2 border-t border-slate-200/50">
                            <div>
                              <label className="block text-[10px] font-bold text-slate-400 mb-0.5">כותרת הוצאה:</label>
                              <input type="text" value={tx.title || ''} onChange={(e) => handleUpdateTxTitle(tx.id, e.target.value)} className="w-full text-xs font-semibold bg-white border border-slate-200 rounded p-1" placeholder="שם הספק/הוצאה" />
                            </div>
                            <div>
                              <label className="block text-[10px] font-bold text-slate-400 mb-0.5">קטגוריה:</label>
                              <select value={tx.suggestedCategory} onChange={(e) => handleUpdateTxCategory(tx.id, e.target.value)} className="w-full text-xs font-bold bg-white border border-slate-200 rounded p-1">
                                {EXPENSE_CATEGORIES.map(ec => (<option key={ec.value} value={ec.value}>{ec.label}</option>))}
                              </select>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Settings */}
          {currentTab === 'settings' && (
            <div className="space-y-6 max-w-4xl">
              <div>
                <h2 className="text-2xl font-black text-slate-900">הגדרות מערכת ואינטגרציות</h2>
                <p className="text-slate-500">סנכרון, הגדרת Stripe והרשאות</p>
              </div>

              <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-6 animate-fadeIn">
                <div>
                  <h3 className="font-extrabold text-slate-900 mb-3 text-base">חיבור לשער הסליקה Stripe</h3>
                  <div className="flex items-center space-x-3 space-x-reverse bg-amber-50 border border-amber-200 p-4 rounded-xl">
                    <span className="w-3 h-3 bg-amber-500 rounded-full"></span>
                    <div className="flex-1">
                      <p className="font-bold text-amber-800 text-sm">סטטוס: Stripe טרם חובר (שלב הבא)</p>
                      <p className="text-xs text-amber-700">בשלב הבא נחבר את חשבון ה-Stripe שלך כך שכל תרומה מקוונת תיווצר אוטומטית במערכת.</p>
                    </div>
                  </div>
                </div>

                <hr className="border-slate-100" />

                <div>
                  <h3 className="font-extrabold text-slate-900 mb-2 text-base">פרטי הארגון</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                    <div>
                      <label className="block text-xs font-bold text-slate-400 mb-1">שם הארגון</label>
                      <input type="text" readOnly value={ORG.legalName} className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 font-medium" />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-400 mb-1">מטבע פעילות</label>
                      <input type="text" readOnly value="יורו (EUR)" className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 font-medium" />
                    </div>
                  </div>
                </div>

                <hr className="border-slate-100" />

                <div>
                  <h3 className="font-extrabold text-slate-900 mb-2 text-base">ניהול נתונים</h3>
                  <p className="text-sm text-slate-500 mb-4">הנתונים נשמרים בבסיס נתונים מאובטח (Supabase). ניתן למחוק את כל הנתונים ולהתחיל מחדש — פעולה בלתי הפיכה.</p>
                  <button
                    onClick={() => {
                      if (window.confirm('האם אתה בטוח? פעולה זו תמחק את כל הנתונים מהשרת לצמיתות.')) {
                        run(() => data.clearAll(), () => showToast('כל הנתונים נמחקו והמערכת אופסה.'));
                      }
                    }}
                    className="px-4 py-2 bg-rose-50 hover:bg-rose-100 text-rose-700 font-bold rounded-lg border border-rose-200 transition"
                  >
                    מחק את כל הנתונים
                  </button>
                </div>
              </div>
            </div>
          )}

        </main>
      </div>

      {/* ═══ Modals ═══ */}

      {/* Add Fundraiser */}
      {showAddFundraiserModal && (
        <Modal onClose={() => setShowAddFundraiserModal(false)} title="הוספת מתרים חדש">
          <form onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.target);
            handleAddFundraiser({ name: fd.get('name'), email: fd.get('email'), phone: fd.get('phone'), target: Number(fd.get('target')) });
          }} className="space-y-3 text-sm">
            <Field label="שם המתרים"><input required name="name" type="text" className="modal-input" /></Field>
            <Field label="כתובת אימייל"><input required name="email" type="email" className="modal-input" /></Field>
            <Field label="מספר טלפון"><input required name="phone" type="text" className="modal-input" /></Field>
            <Field label="יעד גיוס (₪)"><input required name="target" type="number" min="1" className="modal-input" /></Field>
            <ModalButtons onCancel={() => setShowAddFundraiserModal(false)} submitLabel="שמור מתרים" submitClass="bg-indigo-600 hover:bg-indigo-700" />
          </form>
        </Modal>
      )}

      {/* Add Donor */}
      {showAddDonorModal && (
        <Modal onClose={() => setShowAddDonorModal(false)} title="הוספת תורם חדש">
          <form onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.target);
            handleAddDonor({ name: fd.get('name'), email: fd.get('email'), phone: fd.get('phone'), city: fd.get('city'), assignedFundraiserId: fd.get('assignedFundraiserId') });
          }} className="space-y-3 text-sm">
            <Field label="שם מלא"><input required name="name" type="text" className="modal-input" /></Field>
            <Field label="כתובת אימייל"><input name="email" type="email" className="modal-input" /></Field>
            <Field label="מספר טלפון"><input required name="phone" type="text" className="modal-input" /></Field>
            <Field label="עיר מגורים"><input name="city" type="text" className="modal-input" /></Field>
            <Field label="שייך למתרים אחראי">
              <select name="assignedFundraiserId" className="modal-input">
                {fundraisers.map(f => (<option key={f.id} value={f.id}>{f.name}</option>))}
              </select>
            </Field>
            <ModalButtons onCancel={() => setShowAddDonorModal(false)} submitLabel="שמור תורם" submitClass="bg-slate-900 hover:bg-slate-800" />
          </form>
        </Modal>
      )}

      {/* Add Recipient */}
      {showAddRecipientModal && (
        <Modal onClose={() => setShowAddRecipientModal(false)} title="הוספת משפחה נתמכת">
          <form onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.target);
            handleAddRecipient({ name: fd.get('name'), familySize: Number(fd.get('familySize')), address: fd.get('address') });
          }} className="space-y-3 text-sm">
            <Field label="שם המשפחה"><input required name="name" type="text" className="modal-input" /></Field>
            <Field label="מספר נפשות"><input required name="familySize" type="number" min="1" className="modal-input" /></Field>
            <Field label="עיר / כתובת"><input required name="address" type="text" className="modal-input" /></Field>
            <ModalButtons onCancel={() => setShowAddRecipientModal(false)} submitLabel="שמור נתמך" submitClass="bg-slate-900 hover:bg-slate-800" />
          </form>
        </Modal>
      )}

      {/* Add Pledge (הו"ק) */}
      {showAddPledgeModal && (
        <Modal onClose={() => setShowAddPledgeModal(false)} title="רישום התחייבות חודשית (הו&quot;ק)">
          <form onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.target);
            handleAddPledge({
              donorId: fd.get('donorId'),
              amount: Number(fd.get('amount')),
              method: fd.get('method'),
              billingDay: Number(fd.get('billingDay')),
              startDate: fd.get('startDate'),
              campaignId: fd.get('campaignId'),
              notes: fd.get('notes'),
            });
          }} className="space-y-3 text-sm">
            <Field label="תורם מתחייב">
              <select name="donorId" required className="modal-input">
                {donors.map(d => (<option key={d.id} value={d.id}>{d.name}{d.phone ? ` (${d.phone})` : ''}</option>))}
              </select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={`סכום חודשי (${C})`}><input required name="amount" type="number" min="1" className="modal-input" placeholder="לדוגמה: 50" /></Field>
              <Field label="אופן תשלום">
                <select name="method" className="modal-input">{PLEDGE_METHODS.map(m => (<option key={m.value} value={m.value}>{m.label}</option>))}</select>
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="יום חיוב בחודש"><input required name="billingDay" type="number" min="1" max="28" defaultValue="1" className="modal-input" /></Field>
              <Field label="בתוקף מתאריך"><DatePicker name="startDate" defaultValue={new Date().toISOString().split('T')[0]} required /></Field>
            </div>
            <Field label="שיוך למגבית">
              <select name="campaignId" className="modal-input">{campaigns.map(c => (<option key={c.id} value={c.id}>{c.name}</option>))}</select>
            </Field>
            <Field label="הערות (אופציונלי)"><input name="notes" type="text" className="modal-input" placeholder="לדוגמה: דרך כרטיס אשראי בסטרייפ" /></Field>
            <ModalButtons onCancel={() => setShowAddPledgeModal(false)} submitLabel="שמור התחייבות" submitClass="bg-indigo-600 hover:bg-indigo-700" />
          </form>
        </Modal>
      )}

      {/* Online Donation (Stripe Checkout) */}
      {showOnlineDonationModal && (
        <Modal onClose={() => setShowOnlineDonationModal(false)} title="תרומה אונליין דרך Stripe">
          <form onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.target);
            const donorId = fd.get('donorId');
            const donor = donors.find(d => d.id === donorId);
            handleOnlineDonation({
              amount: Number(fd.get('amount')),
              campaignId: fd.get('campaignId'),
              donorId: donorId || '',
              donorName: donor?.name || '',
              email: fd.get('email') || donor?.email || '',
            });
          }} className="space-y-3 text-sm">
            <div className="bg-indigo-50 border border-indigo-100 p-3 rounded-xl text-xs text-indigo-800">
              לאחר אישור — תועבר לעמוד תשלום מאובטח של Stripe. התרומה תיקלט אוטומטית במערכת בסיום.
            </div>
            <Field label="תורם (אופציונלי — לשיוך התרומה)">
              <select name="donorId" className="modal-input">
                <option value="">תרומה אנונימית / ללא שיוך</option>
                {donors.map(d => (<option key={d.id} value={d.id}>{d.name}</option>))}
              </select>
            </Field>
            <Field label="אימייל לקבלה (אופציונלי)"><input name="email" type="email" className="modal-input" placeholder="donor@example.com" /></Field>
            <Field label={`סכום התרומה (${C})`}><input required name="amount" type="number" min="1" className="modal-input" placeholder="לדוגמה: 100" /></Field>
            <Field label="שיוך למגבית">
              <select name="campaignId" className="modal-input">{campaigns.map(c => (<option key={c.id} value={c.id}>{c.name}</option>))}</select>
            </Field>
            <ModalButtons onCancel={() => setShowOnlineDonationModal(false)} submitLabel="המשך לתשלום ב-Stripe ←" submitClass="bg-indigo-600 hover:bg-indigo-700" />
          </form>
        </Modal>
      )}

      {/* Record Pledge Payment */}
      {payingPledge && (
        <Modal onClose={() => setPayingPledge(null)} title={`רישום תשלום — ${donors.find(d => d.id === payingPledge.donorId)?.name || 'תורם'}`}>
          <form onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.target);
            handlePayPledge(payingPledge, { amount: Number(fd.get('amount')), method: fd.get('method'), date: fd.get('date') });
          }} className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-3">
              <Field label={`סכום (${C})`}><input required name="amount" type="number" min="1" defaultValue={payingPledge.amount} className="modal-input" /></Field>
              <Field label="אופן תשלום">
                <select name="method" defaultValue={payingPledge.method || 'bank'} className="modal-input">{PLEDGE_METHODS.map(m => (<option key={m.value} value={m.value}>{m.label}</option>))}</select>
              </Field>
            </div>
            <Field label="תאריך תשלום"><DatePicker name="date" defaultValue={new Date().toISOString().split('T')[0]} required /></Field>
            <ModalButtons onCancel={() => setPayingPledge(null)} submitLabel="רשום תשלום" submitClass="bg-emerald-600 hover:bg-emerald-700" />
          </form>
        </Modal>
      )}

      {/* Pledge Payment History */}
      {historyPledge && (
        <Modal onClose={() => setHistoryPledge(null)} title={`היסטוריית תשלומים — ${donors.find(d => d.id === historyPledge.donorId)?.name || 'תורם'}`}>
          {(() => {
            const pays = donations.filter(d => d.pledgeId === historyPledge.id).slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''));
            const srcLabel = (s) => s === 'Stripe' ? 'אשראי' : s === 'בנק' ? 'העברה בנקאית' : s === 'ידני' ? 'מזומן/ידני' : s;
            return (
              <div className="space-y-3">
                <div className="flex justify-between text-xs bg-slate-50 rounded-lg p-3">
                  <span className="text-slate-500">התחייבות: <strong className="text-slate-800">{C}{historyPledge.amount.toLocaleString()}/חודש</strong></span>
                  <span className="text-slate-500">סה"כ שולם: <strong className="text-emerald-600">{C}{pays.reduce((s, d) => s + d.amount, 0).toLocaleString()}</strong> ({pays.length} תשלומים)</span>
                </div>
                {pays.length === 0 ? (
                  <p className="text-sm text-slate-400 text-center py-6">טרם נרשמו תשלומים להתחייבות זו.</p>
                ) : (
                  <div className="max-h-72 overflow-y-auto divide-y divide-slate-100 border border-slate-100 rounded-lg">
                    {pays.map(d => (
                      <div key={d.id} className="flex justify-between items-center p-3 text-sm">
                        <div>
                          <p className="font-bold text-slate-800">{d.date}</p>
                          <p className="text-xs text-slate-400">{srcLabel(d.source)}</p>
                        </div>
                        <span className="font-black text-emerald-600">{C}{d.amount.toLocaleString()}</span>
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex justify-end pt-2">
                  <button type="button" onClick={() => setHistoryPledge(null)} className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-lg">סגור</button>
                </div>
              </div>
            );
          })()}
        </Modal>
      )}

      {/* Add Donation */}
      {showAddDonationModal && (
        <div className="fixed inset-0 bg-slate-900/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl border border-slate-100 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center border-b border-slate-100 pb-3">
              <h3 className="text-xl font-extrabold text-slate-900">הזנת תרומה חדשה</h3>
              <button type="button" onClick={() => { setShowAddDonationModal(false); setSelectedMultiDonorIds([]); setMultiDonorSearchText(''); }} className="text-slate-400 hover:text-slate-600 font-bold">✕</button>
            </div>

            <div className="flex bg-slate-100 p-1 rounded-xl">
              <button type="button" onClick={() => setDonationMode('single')} className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all ${donationMode === 'single' ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}>👤 תרומה בודדת</button>
              <button type="button" onClick={() => setDonationMode('multi')} className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all ${donationMode === 'multi' ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}>👥 תרומה קבוצתית</button>
            </div>

            {donationMode === 'single' ? (
              <form onSubmit={(e) => {
                e.preventDefault();
                if (!selectedDonorId) { showToast('נא לבחור תורם מהרשימה', 'error'); return; }
                const fd = new FormData(e.target);
                handleAddDonation({ donorId: selectedDonorId, amount: Number(fd.get('amount')), campaignId: fd.get('campaignId'), source: fd.get('source') });
              }} className="space-y-3 text-sm">
                <div className="relative">
                  <label className="block font-bold text-slate-600 mb-1">חפש ובחר תורם</label>
                  <input required type="text" className="w-full border border-slate-200 rounded-lg p-2.5 focus:ring-2 focus:ring-indigo-500 focus:outline-none text-slate-800 font-medium" placeholder="הקלד שם, טלפון או עיר..." value={donorSearchText}
                    onChange={(e) => { setDonorSearchText(e.target.value); setSelectedDonorId(''); setShowDonorDropdown(true); }}
                    onFocus={() => setShowDonorDropdown(true)} />
                  {showDonorDropdown && (
                    <>
                      <div className="fixed inset-0 z-10" onClick={(e) => { e.stopPropagation(); setShowDonorDropdown(false); }} />
                      <div className="absolute z-20 left-0 right-0 mt-1 max-h-52 overflow-y-auto bg-white border border-slate-200 rounded-lg shadow-xl divide-y divide-slate-50">
                        {filteredDonorsForDonation.length > 0 ? filteredDonorsForDonation.map(d => (
                          <button key={d.id} type="button" onClick={() => { setSelectedDonorId(d.id); setDonorSearchText(`${d.name} (${d.city})`); setShowDonorDropdown(false); }}
                            className={`w-full text-right px-4 py-2.5 hover:bg-indigo-50/70 transition flex justify-between items-center ${selectedDonorId === d.id ? 'bg-indigo-50 font-bold text-indigo-700' : 'text-slate-700'}`}>
                            <div><p className="font-bold text-sm">{d.name}</p><p className="text-[10px] text-slate-400">{d.city} • {d.email}</p></div>
                            <span className="text-xs text-slate-400 font-mono">{d.phone}</span>
                          </button>
                        )) : (
                          <div className="p-4 text-xs text-slate-400 text-center">
                            לא נמצא תורם תואם.
                            <button type="button" onClick={() => { setShowDonorDropdown(false); setShowAddDonationModal(false); setShowAddDonorModal(true); }} className="text-indigo-600 font-bold underline mr-1">הוסף תורם חדש</button>
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>
                <Field label="סכום התרומה (₪)"><input required name="amount" type="number" min="1" className="modal-input" /></Field>
                <Field label="שיוך למגבית">
                  <select name="campaignId" className="modal-input">{campaigns.map(c => (<option key={c.id} value={c.id}>{c.name}</option>))}</select>
                </Field>
                <Field label="מקור תקבול">
                  <select name="source" className="modal-input">
                    <option value="ידני">משרד (מזומן / צ׳ק)</option>
                    <option value="Stripe">Stripe (אשראי מקוון)</option>
                    <option value="בנק">העברה בנקאית</option>
                  </select>
                </Field>
                <ModalButtons onCancel={() => setShowAddDonationModal(false)} submitLabel="אשר קבלת תרומה" submitClass="bg-emerald-600 hover:bg-emerald-700" />
              </form>
            ) : (
              <form onSubmit={(e) => {
                e.preventDefault();
                if (selectedMultiDonorIds.length === 0) { showToast('נא לבחור לפחות תורם אחד', 'error'); return; }
                const fd = new FormData(e.target);
                handleAddMultiDonation({ donorIds: selectedMultiDonorIds, amount: Number(fd.get('amount')), campaignId: fd.get('campaignId'), source: fd.get('source') });
              }} className="space-y-3 text-sm">
                <div className="relative">
                  <label className="block font-bold text-slate-600 mb-1">חפש והוסף תורמים לקבוצה</label>
                  <input type="text" className="w-full border border-slate-200 rounded-lg p-2.5 focus:ring-2 focus:ring-indigo-500 focus:outline-none text-slate-800 font-medium" placeholder="הקלד שם..." value={multiDonorSearchText}
                    onChange={(e) => { setMultiDonorSearchText(e.target.value); setShowMultiDonorDropdown(true); }}
                    onFocus={() => setShowMultiDonorDropdown(true)} />
                  {showMultiDonorDropdown && (
                    <>
                      <div className="fixed inset-0 z-10" onClick={() => setShowMultiDonorDropdown(false)} />
                      <div className="absolute z-20 left-0 right-0 mt-1 max-h-44 overflow-y-auto bg-white border border-slate-200 rounded-lg shadow-xl divide-y divide-slate-50">
                        {donors.filter(d => {
                          const q = multiDonorSearchText.toLowerCase();
                          return ((d.name || '').toLowerCase().includes(q) || (d.city || '').toLowerCase().includes(q) || (d.phone || '').includes(q)) && !selectedMultiDonorIds.includes(d.id);
                        }).map(d => (
                          <button key={d.id} type="button" onClick={() => { setSelectedMultiDonorIds([...selectedMultiDonorIds, d.id]); setMultiDonorSearchText(''); setShowMultiDonorDropdown(false); }}
                            className="w-full text-right px-4 py-2 hover:bg-indigo-50 transition flex justify-between items-center">
                            <div><p className="font-bold text-sm text-slate-800">{d.name}</p><p className="text-[10px] text-slate-400">{d.city} • {d.phone}</p></div>
                            <span className="text-xs text-indigo-600 font-bold">+ הוסף</span>
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
                {selectedMultiDonorIds.length > 0 && (
                  <div className="space-y-1.5">
                    <span className="text-xs font-bold text-slate-500">תורמים שנבחרו ({selectedMultiDonorIds.length}):</span>
                    <div className="flex flex-wrap gap-1.5 p-2 bg-slate-50 border border-slate-200 rounded-xl max-h-24 overflow-y-auto">
                      {selectedMultiDonorIds.map(id => {
                        const d = donors.find(donor => donor.id === id);
                        return (
                          <span key={id} className="inline-flex items-center bg-indigo-50 text-indigo-700 px-2.5 py-1 rounded-lg text-xs font-bold border border-indigo-100">
                            {d?.name}
                            <button type="button" onClick={() => setSelectedMultiDonorIds(selectedMultiDonorIds.filter(mid => mid !== id))} className="mr-1.5 hover:text-rose-600 text-indigo-400 font-black" title="הסר">✕</button>
                          </span>
                        );
                      })}
                    </div>
                  </div>
                )}
                <Field label="סכום אחיד לכל תורם (₪)"><input required name="amount" type="number" min="1" className="modal-input" placeholder="סכום לכל תורם בנפרד" /></Field>
                <Field label="שיוך למגבית">
                  <select name="campaignId" className="modal-input">{campaigns.map(c => (<option key={c.id} value={c.id}>{c.name}</option>))}</select>
                </Field>
                <Field label="מקור תקבול">
                  <select name="source" className="modal-input">
                    <option value="ידני">משרד (מזומן / צ׳ק)</option>
                    <option value="Stripe">Stripe (אשראי מקוון)</option>
                    <option value="בנק">העברה בנקאית</option>
                  </select>
                </Field>
                <div className="flex justify-end space-x-3 space-x-reverse pt-4">
                  <button type="button" onClick={() => { setShowAddDonationModal(false); setSelectedMultiDonorIds([]); setMultiDonorSearchText(''); }} className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-lg">ביטול</button>
                  <button type="submit" className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-lg shadow-sm">אשר ורשום {selectedMultiDonorIds.length > 0 ? selectedMultiDonorIds.length : ''} תרומות</button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Add Request */}
      {showAddRequestModal && (
        <Modal onClose={() => setShowAddRequestModal(false)} title="יצירת בקשת תמיכה">
          <form onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.target);
            handleAddRequest({ recipientId: fd.get('recipientId'), amountRequested: Number(fd.get('amountRequested')), priority: fd.get('priority'), category: fd.get('category') });
          }} className="space-y-3 text-sm">
            <Field label="בחר נתמך / משפחה">
              <select name="recipientId" className="modal-input">{recipients.map(r => (<option key={r.id} value={r.id}>{r.name} (נפשות: {r.familySize})</option>))}</select>
            </Field>
            <Field label="קטגוריית הסיוע">
              <select name="category" className="modal-input">{SUPPORT_CATEGORIES.map(cat => (<option key={cat} value={cat}>{cat}</option>))}</select>
            </Field>
            <Field label="סכום מבוקש"><input required name="amountRequested" type="number" min="1" className="modal-input" /></Field>
            <Field label="רמת דחיפות">
              <select name="priority" className="modal-input">{PRIORITY_LEVELS.map(p => (<option key={p} value={p}>{p}</option>))}</select>
            </Field>
            <ModalButtons onCancel={() => setShowAddRequestModal(false)} submitLabel="שלח לבחינה" submitClass="bg-indigo-600 hover:bg-indigo-700" />
          </form>
        </Modal>
      )}

      {/* Add Expense */}
      {showAddExpenseModal && (
        <Modal onClose={() => setShowAddExpenseModal(false)} title="הזנת הוצאה">
          <form onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.target);
            handleAddExpense({ title: fd.get('title'), amount: Number(fd.get('amount')), category: fd.get('category') });
          }} className="space-y-3 text-sm">
            <Field label="תיאור ההוצאה / ספק"><input required name="title" type="text" className="modal-input" /></Field>
            <Field label="סכום ההוצאה"><input required name="amount" type="number" min="1" className="modal-input" /></Field>
            <Field label="קטגוריה">
              <select name="category" className="modal-input">{EXPENSE_CATEGORIES.map(ec => (<option key={ec.value} value={ec.value}>{ec.label}</option>))}</select>
            </Field>
            <ModalButtons onCancel={() => setShowAddExpenseModal(false)} submitLabel="אשר וגרע מהקופה" submitClass="bg-rose-600 hover:bg-rose-700" />
          </form>
        </Modal>
      )}

    </div>
  );
}

// ─── רכיבי עזר למודלים ───
function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 bg-slate-900/60 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl border border-slate-100 space-y-4 max-h-[90vh] overflow-y-auto">
        <h3 className="text-xl font-extrabold text-slate-900">{title}</h3>
        {children}
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <label className="block font-bold text-slate-600 mb-1">{label}</label>
      {children}
    </div>
  );
}

function ModalButtons({ onCancel, submitLabel, submitClass }) {
  return (
    <div className="flex justify-end space-x-3 space-x-reverse pt-4">
      <button type="button" onClick={onCancel} className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-lg">ביטול</button>
      <button type="submit" className={`px-4 py-2 text-white font-bold rounded-lg ${submitClass}`}>{submitLabel}</button>
    </div>
  );
}

// ─── מנוע סימולציית החלוקה ───
function DistributionSim({ requests, recipients, availableBudget, onSave, currentRole }) {
  const [allocations, setAllocations] = useState(
    requests.reduce((acc, r) => { acc[r.id] = r.amountApproved || 0; return acc; }, {})
  );

  const totalAllocated = Object.values(allocations).reduce((sum, val) => sum + Number(val), 0);
  const remainingBudget = availableBudget - totalAllocated;

  const sortedRequests = [...requests].sort((a, b) => {
    const recA = recipients.find(r => r.id === a.recipientId);
    const recB = recipients.find(r => r.id === b.recipientId);
    return (recB?.priorityScore || 0) - (recA?.priorityScore || 0);
  });

  const handleValChange = (reqId, value, maxAllowed) => {
    const numericVal = Math.min(maxAllowed, Math.max(0, Number(value)));
    setAllocations({ ...allocations, [reqId]: numericVal });
  };

  const applyAutoHeuristic = () => {
    let pool = availableBudget;
    const tempAlloc = {};
    sortedRequests.forEach(req => {
      const needed = req.amountRequested;
      if (pool >= needed) { tempAlloc[req.id] = needed; pool -= needed; }
      else if (pool > 0) { tempAlloc[req.id] = pool; pool = 0; }
      else { tempAlloc[req.id] = 0; }
    });
    setAllocations(tempAlloc);
  };

  return (
    <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-6 animate-fadeIn">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-slate-100 pb-4">
        <div>
          <h3 className="font-extrabold text-slate-900 text-lg">בקרת החלטת עובד לפי עדיפויות</h3>
          <p className="text-sm text-slate-400">התאם סכומים ידנית. מנוע העדיפויות מציג תחילה בקשות קריטיות.</p>
        </div>
        <button type="button" onClick={applyAutoHeuristic} className="px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-lg text-xs font-bold transition">⚙️ הצעת חלוקה חכמה</button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 bg-slate-50 p-4 rounded-xl">
        <div>
          <span className="text-xs text-slate-400 font-semibold">סך בקשות מבוקש:</span>
          <p className="text-lg font-bold text-slate-800">{C}{requests.reduce((s, r) => s + r.amountRequested, 0).toLocaleString()}</p>
        </div>
        <div>
          <span className="text-xs text-slate-400 font-semibold">הקצאה מתוכננת:</span>
          <p className="text-lg font-bold text-slate-900">{C}{totalAllocated.toLocaleString()}</p>
        </div>
        <div>
          <span className="text-xs text-slate-400 font-semibold">יתרה לאחר חלוקה:</span>
          <p className={`text-lg font-bold ${remainingBudget >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{C}{remainingBudget.toLocaleString()}</p>
        </div>
      </div>

      <div className="space-y-4">
        {sortedRequests.map(req => {
          const recipient = recipients.find(r => r.id === req.recipientId);
          return (
            <div key={req.id} className="flex flex-col md:flex-row items-start md:items-center justify-between p-4 bg-slate-50/40 border border-slate-100 rounded-xl gap-4">
              <div className="flex-1">
                <div className="flex items-center space-x-2 space-x-reverse">
                  <span className="font-bold text-slate-950">{recipient ? recipient.name : 'נתמך'}</span>
                  <span className="text-xs px-2 py-0.5 bg-indigo-50 text-indigo-700 rounded font-bold">ציון: {recipient?.priorityScore}</span>
                </div>
                <p className="text-xs text-slate-400 mt-1">נפשות: {recipient?.familySize} | קטגוריה: {req.category || '—'} | דחיפות: {req.priority}</p>
              </div>
              <div className="flex items-center space-x-4 space-x-reverse">
                <div className="text-left">
                  <span className="text-xs text-slate-400">מבוקש:</span>
                  <p className="font-bold text-slate-700">{C}{req.amountRequested.toLocaleString()}</p>
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">מאושר להעברה:</label>
                  <input type="number" value={allocations[req.id] || ''} onChange={(e) => handleValChange(req.id, e.target.value, req.amountRequested)} className="w-28 border border-slate-200 rounded-lg px-2.5 py-1.5 text-sm font-bold text-slate-800" placeholder={`${C}0`} />
                </div>
              </div>
            </div>
          );
        })}
        {requests.length === 0 && <p className="text-sm text-slate-400 text-center py-8">אין בקשות תמיכה לחלוקה. הוסף בקשות במסך "נתמכים ובקשות".</p>}
      </div>

      <div className="flex justify-between items-center pt-4 border-t border-slate-100">
        <p className="text-xs text-slate-400">רק <strong>מנהל</strong> או <strong>עובד</strong> רשאים לעדכן את החלוקה.</p>
        <button onClick={() => onSave(allocations)} disabled={currentRole === 'Fundraiser' || currentRole === 'Committee' || remainingBudget < 0} className="px-6 py-2.5 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-xl shadow-md transition disabled:bg-slate-300">
          {remainingBudget < 0 ? 'חריגה מתקציב!' : 'אישור ושמירת חלוקה'}
        </button>
      </div>
    </div>
  );
}
