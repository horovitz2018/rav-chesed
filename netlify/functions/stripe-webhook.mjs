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
// מחזיר true רק אם נרשמה תרומה חדשה (כדי לא לעדכן סכומים פעמיים).
async function recordDonation({ donorId, campaignId, amount, stripeId, pledgeId, date, checkoutSessionId }) {
  const row = {
    donor_id: donorId || null,
    amount,
    campaign_id: campaignId || null,
    source: 'Stripe',
    date: date || today(),
    status: 'הושלם',
    stripe_id: stripeId || null,
    pledge_id: pledgeId || null,
    stripe_checkout_session_id: checkoutSessionId || null,
  };

  let inserted = true;
  if (checkoutSessionId) {
    // אידמפוטנטיות קשיחה לפי מזהה ה-Checkout Session (אינדקס ייחודי)
    const { data } = await supabase
      .from('donations')
      .upsert(row, { onConflict: 'stripe_checkout_session_id', ignoreDuplicates: true })
      .select('id');
    inserted = !!(data && data.length);
  } else {
    // עבור חשבוניות מנוי — בדיקה לפי stripe_id למניעת כפילות
    if (stripeId) {
      const { data: exists } = await supabase.from('donations').select('id').eq('stripe_id', stripeId).maybeSingle();
      if (exists) inserted = false;
    }
    if (inserted) await supabase.from('donations').insert(row);
  }

  if (inserted) {
    await increment('donors', donorId, 'total_donated', amount);
    await increment('campaigns', campaignId, 'raised', amount);
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
            stripeId: s.payment_intent || s.id,
            checkoutSessionId: s.id,
          });
        }
        break;
      }

      // תשלום מנוי (הו"ק) נגבה בהצלחה — יטופל בשלב המנויים
      case 'invoice.paid': {
        const inv = evt.data.object;
        const md = (inv.subscription_details && inv.subscription_details.metadata) || inv.metadata || {};
        if (md.pledgeId) {
          await recordDonation({
            donorId: md.donorId,
            campaignId: md.campaignId,
            amount: (inv.amount_paid || 0) / 100,
            stripeId: inv.payment_intent || inv.id,
            pledgeId: md.pledgeId,
          });
        }
        break;
      }

      default:
        break;
    }
    return { statusCode: 200, body: JSON.stringify({ received: true }) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
