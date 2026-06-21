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
