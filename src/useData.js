import { useState, useEffect, useCallback } from 'react';
import { fetchTable, insertRow, insertRows, updateRow, deleteRow, deleteAllRows, TABLES } from './db.js';
import { normalizePhone, parseEuroAmount, normalizePledgeMethod } from './csv.js';

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

  const clean = (v) => { const t = (v ?? '').toString().trim(); return t === '' ? null : t; };

  const addDonor = async (donorData) => {
    const created = await insertRow('donors', {
      ...donorData,
      groupName: clean(donorData.groupName),
      subgroupName: clean(donorData.subgroupName),
      totalDonated: 0,
      assignedFundraiserId: donorData.assignedFundraiserId || fundraisers[0]?.id || null,
    });
    setDonors((prev) => [...prev, created]);
    return created;
  };

  const updateDonor = async (id, patch) => {
    const p = { ...patch };
    if ('groupName' in p) p.groupName = clean(p.groupName);
    if ('subgroupName' in p) p.subgroupName = clean(p.subgroupName);
    const updated = await updateRow('donors', id, p);
    setDonors((prev) => prev.map((d) => (d.id === id ? updated : d)));
    return updated;
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

  // ─── מגביות ───
  const addCampaign = async (campData) => {
    const isGroup = campData.audienceType === 'group';
    const created = await insertRow('campaigns', {
      name: campData.name,
      target: Number(campData.target) || 0,
      category: clean(campData.category),
      audienceType: isGroup ? 'group' : 'general',
      audienceGroup: isGroup ? clean(campData.audienceGroup) : null,
      audienceSubgroup: isGroup ? clean(campData.audienceSubgroup) : null,
      raised: 0,
    });
    setCampaigns((prev) => [...prev, created]);
    return created;
  };

  const updateCampaign = async (id, patch) => {
    const p = { ...patch };
    if ('target' in p) p.target = Number(p.target) || 0;
    if ('category' in p) p.category = clean(p.category);
    if ('audienceType' in p) {
      const isGroup = p.audienceType === 'group';
      p.audienceType = isGroup ? 'group' : 'general';
      p.audienceGroup = isGroup ? clean(p.audienceGroup) : null;
      p.audienceSubgroup = isGroup ? clean(p.audienceSubgroup) : null;
    }
    const updated = await updateRow('campaigns', id, p);
    setCampaigns((prev) => prev.map((c) => (c.id === id ? updated : c)));
    return updated;
  };

  const deleteCampaign = async (id) => {
    await deleteRow('campaigns', id);
    setCampaigns((prev) => prev.filter((c) => c.id !== id));
  };

  // ─── יבוא המוני של תורמים מ-CSV (+ יצירת התחייבויות) ───
  const bulkImportDonors = async (rows, mapping, options = {}, onProgress) => {
    const get = (row, key) => {
      const idx = mapping[key];
      return idx != null && idx !== '' ? (row[idx] ?? '').toString().trim() : '';
    };

    // מבני דה-דופ מהמצב הקיים (+ נצבר תוך כדי הריצה)
    const phoneSet = new Set(donors.map((d) => normalizePhone(d.phone)).filter(Boolean));
    const nameSet = new Set(
      donors.map((d) => `${(d.firstName || '').trim()}|${(d.lastName || '').trim()}`.toLowerCase()).filter((k) => k !== '|')
    );
    const fundByName = {};
    fundraisers.forEach((f) => { if (f.name) fundByName[f.name.trim()] = f.id; });
    const pledgeKeys = new Set(
      pledges.filter((p) => p.status === 'active').map((p) => `${p.donorId}|${p.amount}|${p.method}|${p.campaignId || ''}`)
    );

    let donorsCreated = 0, pledgesCreated = 0, fundraisersCreated = 0, skippedDonors = 0, skippedPledges = 0;
    const warnings = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const firstName = get(row, 'firstName');
      const lastName = get(row, 'lastName');
      const phone = normalizePhone(get(row, 'phone'));
      const nameKey = `${firstName}|${lastName}`.toLowerCase();

      // 1. דה-דופ — מדלגים על כל השורה
      const dup = (phone && phoneSet.has(phone)) || (!phone && nameKey !== '|' && nameSet.has(nameKey));
      if (dup) { skippedDonors++; if (i % 15 === 0) onProgress?.(`מעבד... (${donorsCreated})`); continue; }

      // 2. שדות
      const titleBefore = get(row, 'titleBefore');
      const titleAfter = get(row, 'titleAfter');
      const connection = get(row, 'connection');
      const address = get(row, 'address');
      const groupName = get(row, 'groupName');
      const subgroupName = get(row, 'subgroupName');
      const name = [titleBefore, firstName, lastName, titleAfter].filter(Boolean).join(' ') || firstName || lastName || 'תורם';

      // 3. גובה → מתרים
      const gabai = get(row, 'collector');
      let assignedFundraiserId = null;
      if (gabai) {
        if (fundByName[gabai]) assignedFundraiserId = fundByName[gabai];
        else {
          const f = await insertRow('fundraisers', { name: gabai, target: 0 });
          fundByName[gabai] = f.id; assignedFundraiserId = f.id; fundraisersCreated++;
        }
      }

      // 4. יצירת תורם
      const created = await insertRow('donors', {
        name,
        titleBefore: titleBefore || null,
        firstName: firstName || null,
        lastName: lastName || null,
        titleAfter: titleAfter || null,
        connection: connection || null,
        address: address || null,
        phone: phone || null,
        groupName: groupName || null,
        subgroupName: subgroupName || null,
        assignedFundraiserId,
        totalDonated: 0,
      });
      donorsCreated++;
      if (phone) phoneSet.add(phone); else if (nameKey !== '|') nameSet.add(nameKey);

      // 5. התחייבות
      if (options.createPledges) {
        const amount = parseEuroAmount(get(row, 'amount'));
        if (amount > 0) {
          const methodRaw = get(row, 'method');
          const { method, matched } = normalizePledgeMethod(methodRaw);
          if (!matched) warnings.push(`שורה ${i + 1}: אופן גבייה לא מזוהה ("${methodRaw}") — נקבע בנק.`);
          if (method === 'cash' && !gabai) warnings.push(`שורה ${i + 1}: גבייה במזומן ללא גבאי (${name}).`);
          const campaignId = options.campaignId || null;
          const key = `${created.id}|${amount}|${method}|${campaignId || ''}`;
          if (pledgeKeys.has(key)) { skippedPledges++; }
          else {
            await insertRow('pledges', { donorId: created.id, amount, method, status: 'active', billingDay: 1, campaignId });
            pledgeKeys.add(key); pledgesCreated++;
          }
        }
      }
      if (i % 10 === 0) onProgress?.(`מייבא... (${donorsCreated} תורמים)`);
    }

    return { donorsCreated, pledgesCreated, fundraisersCreated, skippedDonors, skippedPledges, warnings };
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
    addFundraiser, addDonor, assignFundraiser, updateDonor, addRecipient,
    addDonation, addMultiDonation, addRequest, addExpense,
    saveDistribution, markAsPaid,
    addPledge, setPledgeStatus, payPledge, saveSettings,
    addCampaign, updateCampaign, deleteCampaign,
    bulkImportDonors,
    deleteDonation, deletePledge,
    clearAll,
  };
}
