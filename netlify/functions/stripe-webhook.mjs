import { getStripe, supabase } from './_settings.mjs';

const today = () => new Date().toISOString().split('T')[0];

// הגדלת ערך מצטבר (total_donated / raised) בצורה בטוחה
async function increment(table, id, column, delta) {
  if (!id) return;
  const { data } = await supabase.from(table).select(column).eq('id', id).single();
  if (!data) return;
  await supabase.from(table).update({ [column]: (Number(data[column]) || 0) + delta }).eq('id', id);
}

// רישום תרומה אידמפוטנטי + עדכון התורם והמגבית.
// מחזיר true רק אם נרשמה שורה חדשה (כדי לא לעדכן סכומים פעמיים).
async function recordDonation(d) {
  const paidAtIso = d.paidAt || new Date().toISOString();
  const row = {
    donor_id: d.donorId || null,
    amount: d.amount,
    currency: d.currency || 'eur',
    campaign_id: d.campaignId || null,
    source: 'Stripe',
    date: (d.date || paidAtIso).slice(0, 10),
    status: 'הושלם',
    stripe_id: d.stripePaymentIntentId || d.stripeId || null,
    stripe_payment_intent_id: d.stripePaymentIntentId || null,
    stripe_customer_id: d.stripeCustomerId || null,
    stripe_subscription_id: d.stripeSubscriptionId || null,
    stripe_checkout_session_id: d.checkoutSessionId || null,
    donor_email: d.donorEmail || null,
    donor_name: d.donorName || null,
    paid_at: paidAtIso,
    pledge_id: d.pledgeId || null,
  };

  let inserted = true;
  if (d.checkoutSessionId) {
    // אידמפוטנטיות קשיחה לפי מזהה ה-Checkout Session (ON CONFLICT DO NOTHING)
    const { data } = await supabase
      .from('donations')
      .upsert(row, { onConflict: 'stripe_checkout_session_id', ignoreDuplicates: true })
      .select('id');
    inserted = !!(data && data.length);
  } else if (row.stripe_payment_intent_id) {
    const { data: exists } = await supabase.from('donations').select('id').eq('stripe_payment_intent_id', row.stripe_payment_intent_id).maybeSingle();
    if (exists) inserted = false;
    else await supabase.from('donations').insert(row);
  } else {
    await supabase.from('donations').insert(row);
  }

  if (inserted) {
    await increment('donors', row.donor_id, 'total_donated', d.amount);
    await increment('campaigns', row.campaign_id, 'raised', d.amount);
  } else {
    console.log(`duplicate ignored: ${d.checkoutSessionId || row.stripe_payment_intent_id}`);
  }
  return inserted;
}

export const handler = async (event) => {
  const { stripe } = getStripe();
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripe || !webhookSecret) {
    return { statusCode: 400, body: 'Stripe webhook not configured' };
  }

  const sig = event.headers['stripe-signature'];
  let evt;
  try {
    const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
    evt = stripe.webhooks.constructEvent(raw, sig, webhookSecret);
  } catch (e) {
    return { statusCode: 400, body: `Webhook signature error: ${e.message}` };
  }

  try {
    switch (evt.type) {
      // תרומה חד-פעמית הושלמה
      case 'checkout.session.completed': {
        const s = evt.data.object;
        if (s.mode === 'payment' && s.payment_status === 'paid') {
          const md = s.metadata || {};
          await recordDonation({
            donorId: md.donorId,
            campaignId: md.campaignId,
            amount: (s.amount_total || 0) / 100,
            currency: s.currency,
            stripePaymentIntentId: s.payment_intent,
            stripeCustomerId: typeof s.customer === 'string' ? s.customer : s.customer?.id,
            stripeSubscriptionId: s.subscription || null,
            checkoutSessionId: s.id,
            donorEmail: s.customer_details?.email || s.customer_email || null,
            donorName: s.customer_details?.name || md.donorName || null,
            paidAt: new Date((s.created || Date.now() / 1000) * 1000).toISOString(),
          });
        }
        break;
      }

      // תשלום מנוי (הו"ק) נגבה בהצלחה
      case 'invoice.paid': {
        const inv = evt.data.object;
        const md = (inv.subscription_details && inv.subscription_details.metadata) || inv.metadata || {};
        if (md.pledgeId) {
          const paidUnix = inv.status_transitions?.paid_at || inv.created;
          await recordDonation({
            donorId: md.donorId,
            campaignId: md.campaignId,
            amount: (inv.amount_paid || 0) / 100,
            currency: inv.currency,
            stripePaymentIntentId: inv.payment_intent,
            stripeCustomerId: typeof inv.customer === 'string' ? inv.customer : inv.customer?.id,
            stripeSubscriptionId: inv.subscription || null,
            donorEmail: inv.customer_email || null,
            donorName: inv.customer_name || null,
            paidAt: new Date((paidUnix || Date.now() / 1000) * 1000).toISOString(),
            pledgeId: md.pledgeId,
          });
        }
        break;
      }

      default:
        break;
    }
    // מחזיר 200 תמיד לאחר טיפול בטוח (כולל כפילויות) — כדי ש-Stripe לא ינסה שוב
    return { statusCode: 200, body: JSON.stringify({ received: true }) };
  } catch (e) {
    console.error('webhook error:', e.message);
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
