import { useState, useEffect, useCallback } from 'react';
import { fetchTable, insertRow, insertRows, updateRow, deleteRow, deleteAllRows, TABLES } from './db.js';

// Hook מרכזי: טוען את כל הנתונים מ-Supabase ומספק פעולות כתיבה.
// כל פעולה כותבת ל-DB ואז מעדכנת את ה-state המקומי כדי שהממשק יגיב מיד.
export function useData() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [fundraisers, setFundraisers] = useState([]);
  const [donors, setDonors] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [recipients, setRecipients] = useState([]);
  const [requests, setRequests] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [donations, setDonations] = useState([]);
  const [pledges, setPledges] = useState([]);
  const [settings, setSettings] = useState({});

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [f, d, c, r, req, e, don, pl] = await Promise.all(TABLES.map(fetchTable));
      setFundraisers(f);
      setDonors(d);
      setCampaigns(c);
      setRecipients(r);
      setRequests(req);
      setExpenses(e.reverse());      // הוצאות: חדש→ישן
      setDonations(don.reverse());   // תרומות: חדש→ישן
      setPledges(pl);
      const st = await fetchTable('app_settings');
      setSettings(st[0] || {});
    } catch (err) {
      console.error(err);
      setError(err.message || 'שגיאה בטעינת הנתונים מהשרת');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  // ─── פעולות ───

  const addFundraiser = async (fundData) => {
    const created = await insertRow('fundraisers', { ...fundData, target: Number(fundData.target) || 0 });
    setFundraisers((prev) => [...prev, created]);
    return created;
  };

  const addDonor = async (donorData) => {
    const created = await insertRow('donors', {
      ...donorData,
      totalDonated: 0,
      assignedFundraiserId: donorData.assignedFundraiserId || fundraisers[0]?.id || null,
    });
    setDonors((prev) => [...prev, created]);
    return created;
  };

  const assignFundraiser = async (donorId, fundraiserId) => {
    const updated = await updateRow('donors', donorId, { assignedFundraiserId: fundraiserId });
    setDonors((prev) => prev.map((d) => (d.id === donorId ? updated : d)));
    return updated;
  };

  const addRecipient = async (recData) => {
    const created = await insertRow('recipients', {
      ...recData,
      familySize: Number(recData.familySize) || 1,
      priorityScore: 50,
      status: 'פעיל',
    });
    setRecipients((prev) => [...prev, created]);
    return created;
  };

  const addDonation = async (donationData) => {
    const amount = Number(donationData.amount);
    const created = await insertRow('donations', {
      ...donationData,
      amount,
      date: donationData.date || new Date().toISOString().split('T')[0],
      status: 'הושלם',
    });
    setDonations((prev) => [created, ...prev]);

    const donor = donors.find((d) => d.id === donationData.donorId);
    if (donor) {
      const updated = await updateRow('donors', donor.id, { totalDonated: donor.totalDonated + amount });
      setDonors((prev) => prev.map((d) => (d.id === donor.id ? updated : d)));
    }
    const camp = campaigns.find((c) => c.id === donationData.campaignId);
    if (camp) {
      const updated = await updateRow('campaigns', camp.id, { raised: camp.raised + amount });
      setCampaigns((prev) => prev.map((c) => (c.id === camp.id ? updated : c)));
    }
    return created;
  };

  const addMultiDonation = async ({ donorIds, amount, campaignId, source }) => {
    const numericAmount = Number(amount);
    const dateStr = new Date().toISOString().split('T')[0];
    const rows = donorIds.map((donorId) => ({
      donorId, amount: numericAmount, campaignId, source, date: dateStr, status: 'הושלם',
    }));
    const created = await insertRows('donations', rows);
    setDonations((prev) => [...created, ...prev]);

    // עדכון סך תרומות לכל תורם שנבחר
    await Promise.all(donorIds.map(async (id) => {
      const donor = donors.find((d) => d.id === id);
      if (!donor) return;
      const updated = await updateRow('donors', id, { totalDonated: donor.totalDonated + numericAmount });
      setDonors((prev) => prev.map((d) => (d.id === id ? updated : d)));
    }));

    // עדכון המגבית בסכום הכולל
    const camp = campaigns.find((c) => c.id === campaignId);
    if (camp) {
      const updated = await updateRow('campaigns', camp.id, { raised: camp.raised + numericAmount * donorIds.length });
      setCampaigns((prev) => prev.map((c) => (c.id === camp.id ? updated : c)));
    }
    return { count: donorIds.length, amount: numericAmount };
  };

  const addRequest = async (requestData) => {
    const recipient = recipients.find((r) => r.id === requestData.recipientId);
    if (!recipient) throw new Error('לא נמצא נתמך');
    const mult = requestData.priority === 'קריטית' ? 10 : requestData.priority === 'גבוהה' ? 8 : 5;
    const priorityScore = Math.min(100, recipient.familySize * mult + 20);

    const recUpdated = await updateRow('recipients', recipient.id, { priorityScore });
    setRecipients((prev) => prev.map((r) => (r.id === recipient.id ? recUpdated : r)));

    const created = await insertRow('requests', {
      ...requestData,
      amountRequested: Number(requestData.amountRequested),
      amountApproved: 0,
      status: 'בהמתנה',
    });
    setRequests((prev) => [...prev, created]);
    return { request: created, priorityScore };
  };

  const addExpense = async (expenseData) => {
    const created = await insertRow('expenses', {
      ...expenseData,
      amount: Number(expenseData.amount),
      date: expenseData.date || new Date().toISOString().split('T')[0],
    });
    setExpenses((prev) => [created, ...prev]);
    return created;
  };

  const saveDistribution = async (allocations) => {
    const updates = [];
    for (const req of requests) {
      if (allocations[req.id] === undefined) continue;
      const approved = Number(allocations[req.id]);
      const updated = await updateRow('requests', req.id, {
        amountApproved: approved,
        status: approved > 0 ? 'אושר' : 'נדחה',
      });
      updates.push(updated);
    }
    setRequests((prev) => prev.map((r) => updates.find((u) => u.id === r.id) || r));
  };

  const markAsPaid = async (reqId) => {
    const today = new Date().toISOString().split('T')[0];
    const updated = await updateRow('requests', reqId, { status: 'שולם', paidDate: today });
    setRequests((prev) => prev.map((r) => (r.id === reqId ? updated : r)));
  };

  // ─── התחייבויות (הו"ק) ───
  const addPledge = async (pledgeData) => {
    const created = await insertRow('pledges', {
      ...pledgeData,
      amount: Number(pledgeData.amount),
      billingDay: Number(pledgeData.billingDay) || 1,
      frequency: 'monthly',
      status: 'active',
    });
    setPledges((prev) => [...prev, created]);
    return created;
  };

  const setPledgeStatus = async (pledgeId, status) => {
    const updated = await updateRow('pledges', pledgeId, { status });
    setPledges((prev) => prev.map((p) => (p.id === pledgeId ? updated : p)));
    return updated;
  };

  // רישום תשלום של התחייבות — יוצר תרומה המקושרת להתחייבות
  // opts: { amount, method ('stripe'|'bank'|'cash'), date }
  const payPledge = async (pledge, opts = {}) => {
    const amount = opts.amount != null ? Number(opts.amount) : pledge.amount;
    const method = opts.method || pledge.method || 'bank';
    const sourceMap = { stripe: 'Stripe', bank: 'בנק', cash: 'ידני' };
    return addDonation({
      donorId: pledge.donorId,
      amount,
      campaignId: pledge.campaignId || campaigns[0]?.id || null,
      source: sourceMap[method] || 'הו"ק',
      pledgeId: pledge.id,
      date: opts.date || new Date().toISOString().split('T')[0],
    });
  };

  // מחיקת/ניתוק תרומה — מסיר את הרשומה ומעדכן בחזרה את התורם והמגבית
  const deleteDonation = async (donation) => {
    await deleteRow('donations', donation.id);
    setDonations((prev) => prev.filter((d) => d.id !== donation.id));
    const donor = donors.find((d) => d.id === donation.donorId);
    if (donor) {
      const updated = await updateRow('donors', donor.id, { totalDonated: Math.max(0, donor.totalDonated - donation.amount) });
      setDonors((prev) => prev.map((d) => (d.id === donor.id ? updated : d)));
    }
    const camp = campaigns.find((c) => c.id === donation.campaignId);
    if (camp) {
      const updated = await updateRow('campaigns', camp.id, { raised: Math.max(0, camp.raised - donation.amount) });
      setCampaigns((prev) => prev.map((c) => (c.id === camp.id ? updated : c)));
    }
  };

  // מחיקת/ניתוק התחייבות (התרומות המקושרות נשארות, מתנתקות מההתחייבות)
  const deletePledge = async (pledgeId) => {
    await deleteRow('pledges', pledgeId);
    setPledges((prev) => prev.filter((p) => p.id !== pledgeId));
    setDonations((prev) => prev.map((d) => (d.pledgeId === pledgeId ? { ...d, pledgeId: null } : d)));
  };

  // שמירת הגדרות הארגון (כולל מפתחות Stripe)
  const saveSettings = async (patch) => {
    if (!settings.id) throw new Error('שורת ההגדרות לא נטענה');
    const updated = await updateRow('app_settings', settings.id, { ...patch, updatedAt: new Date().toISOString() });
    setSettings(updated);
    return updated;
  };

  const clearAll = async () => {
    for (const t of [...TABLES].reverse()) await deleteAllRows(t);
    await loadAll();
  };

  return {
    loading, error, reload: loadAll,
    fundraisers, donors, campaigns, recipients, requests, expenses, donations, pledges, settings,
    addFundraiser, addDonor, assignFundraiser, addRecipient,
    addDonation, addMultiDonation, addRequest, addExpense,
    saveDistribution, markAsPaid,
    addPledge, setPledgeStatus, payPledge, saveSettings,
    deleteDonation, deletePledge,
    clearAll,
  };
}
