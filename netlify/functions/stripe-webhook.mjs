import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
// לקוח Supabase עם service_role — כותב לבסיס הנתונים מצד השרת (עוקף RLS)
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const today = () => new Date().toISOString().split('T')[0];

// הגדלת ערך מצטבר (total_donated / raised) בצורה בטוחה
async function increment(table, id, column, delta) {
  if (!id) return;
  const { data } = await supabase.from(table).select(column).eq('id', id).single();
  if (!data) return;
  await supabase.from(table).update({ [column]: (Number(data[column]) || 0) + delta }).eq('id', id);
}

// רישום תרומה + עדכון התורם והמגבית
async function recordDonation({ donorId, campaignId, amount, stripeId, pledgeId, date }) {
  await supabase.from('donations').insert({
    donor_id: donorId || null,
    amount,
    campaign_id: campaignId || null,
    source: 'Stripe',
    date: date || today(),
    status: 'הושלם',
    stripe_id: stripeId,
    pledge_id: pledgeId || null,
  });
  await increment('donors', donorId, 'total_donated', amount);
  await increment('campaigns', campaignId, 'raised', amount);
}

export const handler = async (event) => {
  const sig = event.headers['stripe-signature'];
  let evt;
  try {
    const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
    evt = stripe.webhooks.constructEvent(raw, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (e) {
    return { statusCode: 400, body: `Webhook signature error: ${e.message}` };
  }

  try {
    switch (evt.type) {
      // תרומה חד-פעמית הושלמה
      case 'checkout.session.completed': {
        const s = evt.data.object;
        if (s.mode === 'payment') {
          const md = s.metadata || {};
          await recordDonation({
            donorId: md.donorId,
            campaignId: md.campaignId,
            amount: (s.amount_total || 0) / 100,
            stripeId: s.payment_intent || s.id,
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

      // תשלום מנוי נכשל (כרטיס נדחה) — יסומן כפיגור בשלב המנויים
      case 'invoice.payment_failed': {
        const inv = evt.data.object;
        const md = (inv.subscription_details && inv.subscription_details.metadata) || inv.metadata || {};
        if (md.pledgeId) {
          await supabase.from('pledges').update({ status: 'active' }).eq('id', md.pledgeId);
          // (סימון הפיגור נגזר אוטומטית במסך — אין תשלום לחודש זה)
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
