// קריאה לפונקציית ה-serverless שיוצרת Checkout, והפניית הדפדפן לתשלום ב-Stripe.
export async function startDonationCheckout(payload) {
  const res = await fetch('/.netlify/functions/create-donation-checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    let msg = 'שגיאה ביצירת התשלום';
    try { msg = (await res.json()).error || msg; } catch { /* ignore */ }
    throw new Error(msg);
  }
  const data = await res.json();
  if (!data.url) throw new Error(data.error || 'לא התקבל קישור תשלום מ-Stripe');
  window.location.href = data.url; // הפניה לעמוד התשלום של Stripe
}

async function callImport(phase, cursor) {
  const res = await fetch('/.netlify/functions/import-stripe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phase, cursor }),
  });
  if (!res.ok) {
    let msg = 'שגיאה ביבוא מ-Stripe';
    try { msg = (await res.json()).error || msg; } catch { /* ignore */ }
    throw new Error(msg);
  }
  return res.json();
}

// מריץ את היבוא בשלבים (מנויים → תשלומים → סיכום), עם עדכון התקדמות
export async function runStripeImport(onProgress) {
  const totals = { pledges: 0, donations: 0 };

  let r = { hasMore: true, nextCursor: null };
  while (r.hasMore) {
    r = await callImport('subscriptions', r.nextCursor);
    totals.pledges += r.created || 0;
    onProgress?.(`מייבא מנויים חוזרים... (${totals.pledges})`);
  }

  r = { hasMore: true, nextCursor: null };
  while (r.hasMore) {
    r = await callImport('payments', r.nextCursor);
    totals.donations += r.created || 0;
    onProgress?.(`מייבא תשלומים... (${totals.donations})`);
  }

  onProgress?.('מסכם ומחשב סכומים...');
  await callImport('finalize');
  return totals;
}
