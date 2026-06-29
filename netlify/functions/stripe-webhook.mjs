import { getStripe, supabase } from './_settings.mjs';
import { extractDonorboxMeta, getOrCreateDonorboxCampaign, resolveDonorboxDonor, resolveDonorboxPledge } from './_donorbox.mjs';

const asId = (v) => (typeof v === 'string' ? v : v?.id) || null;

async function increment(table, id, column, delta) {
  if (!id) return;
  const { data } = await supabase.from(table).select(column).eq('id', id).single();
  if (!data) return;
  await supabase.from(table).update({ [column]: (Number(data[column]) || 0) + delta }).eq('id', id);
}

// בדיקה+insert על מפתח ייחודי נתון; תופס 23505 למצב race. מחזיר true אם נוצרה שורה.
async function insertUnique(column, value, row) {
  if (value) {
    const { data: exists } = await supabase.from('donations').select('id').eq(column, value).maybeSingle();
    if (exists) return false;
  }
  const { error } = await supabase.from('donations').insert(row);
  if (error) {
    if (error.code === '23505') return false;
    throw error;
  }
  return true;
}

// רישום תרומה אידמפוטנטי + עדכון התורם והמגבית. מחזיר true רק אם נרשמה שורה חדשה.
async function recordDonation(d) {
  const paidAtIso = d.paidAt || new Date().toISOString();
  const piId = d.stripePaymentIntentId || null;
  const row = {
    donor_id: d.donorId || null,
    amount: d.amount,
    currency: d.currency || 'eur',
    campaign_id: d.campaignId || null,
    source: d.source || 'Stripe',
    date: (d.date || paidAtIso).slice(0, 10),
    status: 'הושלם',
    stripe_id: piId || d.checkoutSessionId || null,
    stripe_payment_intent_id: piId,
    stripe_customer_id: d.stripeCustomerId || null,
    stripe_subscription_id: d.stripeSubscriptionId || null,
    stripe_checkout_session_id: d.checkoutSessionId || null,
    donor_email: d.donorEmail || null,
    donor_name: d.donorName || null,
    paid_at: paidAtIso,
    pledge_id: d.pledgeId || null,
  };

  let inserted;
  if (d.checkoutSessionId) inserted = await insertUnique('stripe_checkout_session_id', d.checkoutSessionId, row);
  else if (piId) inserted = await insertUnique('stripe_payment_intent_id', piId, row);
  else { await supabase.from('donations').insert(row); inserted = true; }

  if (inserted) {
    await increment('donors', row.donor_id, 'total_donated', d.amount);
    await increment('campaigns', row.campaign_id, 'raised', d.amount);
  } else {
    console.log(`duplicate ignored: ${d.checkoutSessionId || piId}`);
  }
  return inserted;
}

// חיפוש תורם/הו"ק לפי המזהים ששמורים אצלנו (ללא תלות ב-metadata) — למנויי Stripe נטו
async function lookupDonorByCustomer(customerId) {
  if (!customerId) return null;
  const { data } = await supabase.from('donors').select('id').eq('stripe_customer_id', customerId).maybeSingle();
  return data?.id || null;
}
async function lookupPledgeBySubscription(subscriptionId) {
  if (!subscriptionId) return null;
  const { data } = await supabase.from('pledges').select('id, donor_id, campaign_id').eq('stripe_subscription_id', subscriptionId).maybeSingle();
  return data || null;
}

// טיפול בחיוב/תשלום עם metadata של Donorbox (charge.succeeded / payment_intent.succeeded)
async function handleDonorboxPayment(obj) {
  const meta = extractDonorboxMeta(obj.metadata);
  if (!meta) return; // לא Donorbox — מתעלמים (נמנע מהפרעה לזרימות אחרות)

  const customerId = asId(obj.customer);
  const amount = (obj.amount_received ?? obj.amount ?? 0) / 100;
  const piId = obj.object === 'payment_intent' ? obj.id : asId(obj.payment_intent);

  const campaignId = await getOrCreateDonorboxCampaign();
  const donorId = await resolveDonorboxDonor(customerId, meta);
  const pledgeId = await resolveDonorboxPledge(donorId, meta, amount, campaignId);

  await recordDonation({
    donorId,
    campaignId,
    amount,
    currency: obj.currency,
    stripePaymentIntentId: piId,
    stripeCustomerId: customerId,
    pledgeId,
    source: 'Donorbox',
    donorEmail: meta.email,
    donorName: meta.name,
    paidAt: new Date((obj.created || Date.now() / 1000) * 1000).toISOString(),
  });
}

export const handler = async (event) => {
  const { stripe } = getStripe();
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripe || !webhookSecret) return { statusCode: 400, body: 'Stripe webhook not configured' };

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
      // תרומה חד-פעמית דרך ה-Checkout שלנו
      case 'checkout.session.completed': {
        const s = evt.data.object;
        if (s.mode === 'payment' && s.payment_status === 'paid') {
          const md = s.metadata || {};
          await recordDonation({
            donorId: md.donorId || await lookupDonorByCustomer(asId(s.customer)),
            campaignId: md.campaignId,
            amount: (s.amount_total || 0) / 100,
            currency: s.currency,
            stripePaymentIntentId: asId(s.payment_intent),
            stripeCustomerId: asId(s.customer),
            checkoutSessionId: s.id,
            donorEmail: s.customer_details?.email || s.customer_email || null,
            donorName: s.customer_details?.name || md.donorName || null,
            paidAt: new Date((s.created || Date.now() / 1000) * 1000).toISOString(),
          });
        }
        break;
      }

      // תשלום מנוי Stripe נטו (אם ייווצרו מנויים מתוך האפליקציה) — זיהוי לפי subscription/customer, לא metadata
      case 'invoice.paid':
      case 'invoice.payment_succeeded': {
        const inv = evt.data.object;
        const subId = asId(inv.subscription);
        const customerId = asId(inv.customer);
        const pledge = await lookupPledgeBySubscription(subId);
        const donorId = pledge?.donor_id || await lookupDonorByCustomer(customerId);
        if (donorId) {
          await recordDonation({
            donorId,
            campaignId: pledge?.campaign_id || null,
            amount: (inv.amount_paid || 0) / 100,
            currency: inv.currency,
            stripePaymentIntentId: asId(inv.payment_intent),
            stripeCustomerId: customerId,
            stripeSubscriptionId: subId,
            donorEmail: inv.customer_email || null,
            donorName: inv.customer_name || null,
            paidAt: new Date(((inv.status_transitions && inv.status_transitions.paid_at) || inv.created) * 1000).toISOString(),
            pledgeId: pledge?.id || null,
          });
        }
        break;
      }

      // חיובי Donorbox (charges בודדים בלי invoice/subscription) — זיהוי לפי metadata donorbox_*
      case 'charge.succeeded':
      case 'payment_intent.succeeded': {
        await handleDonorboxPayment(evt.data.object);
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
