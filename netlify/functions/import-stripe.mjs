import { getStripe, supabase } from './_settings.mjs';
import { extractDonorboxMeta, getOrCreateDonorboxCampaign, resolveDonorboxDonor, resolveDonorboxPledge } from './_donorbox.mjs';

const PAGE = 25;
const yearStart = Math.floor(new Date(new Date().getFullYear(), 0, 1).getTime() / 1000);

async function getDefaultCampaignId() {
  const { data } = await supabase.from('campaigns').select('id').order('created_at').limit(1).maybeSingle();
  return data?.id || null;
}

// פתרון מערך לקוחות של Stripe למזהי תורמים (יוצר חסרים בקבוצה, ללא כפילויות)
async function resolveDonors(customers) {
  const map = {};
  const uniq = {};
  for (const c of customers) if (c && c.id) uniq[c.id] = c;
  const ids = Object.keys(uniq);
  if (!ids.length) return map;

  const { data: existing } = await supabase.from('donors').select('id,stripe_customer_id').in('stripe_customer_id', ids);
  (existing || []).forEach((d) => { map[d.stripe_customer_id] = d.id; });

  const missingIds = ids.filter((id) => !map[id]);
  if (!missingIds.length) return map;

  // ניסיון התאמה לפי אימייל
  const emails = missingIds.map((id) => uniq[id].email).filter(Boolean);
  const emailToDonor = {};
  if (emails.length) {
    const { data: byEmail } = await supabase.from('donors').select('id,email').in('email', emails);
    (byEmail || []).forEach((d) => { if (d.email) emailToDonor[d.email] = d.id; });
  }

  const toCreate = [];
  for (const id of missingIds) {
    const c = uniq[id];
    if (c.email && emailToDonor[c.email]) {
      map[id] = emailToDonor[c.email];
      await supabase.from('donors').update({ stripe_customer_id: id }).eq('id', map[id]);
    } else {
      toCreate.push(c);
    }
  }
  if (toCreate.length) {
    const rows = toCreate.map((c) => ({
      name: c.name || c.email || 'תורם מ-Stripe',
      email: c.email || null,
      phone: c.phone || null,
      stripe_customer_id: c.id,
      total_donated: 0,
    }));
    const { data: created } = await supabase.from('donors').insert(rows).select('id,stripe_customer_id');
    (created || []).forEach((d) => { map[d.stripe_customer_id] = d.id; });
  }
  return map;
}

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
  const { stripe } = getStripe();
  if (!stripe) return { statusCode: 400, body: JSON.stringify({ error: 'Stripe טרם הוגדר (חסר STRIPE_SECRET_KEY).' }) };

  try {
    const { phase, cursor } = JSON.parse(event.body || '{}');
    const campaignId = await getDefaultCampaignId();

    // ─── שלב 1: מנויים → התחייבויות ───
    if (phase === 'subscriptions') {
      const subs = await stripe.subscriptions.list({
        limit: PAGE, status: 'all', starting_after: cursor || undefined, expand: ['data.customer'],
      });
      const donorMap = await resolveDonors(subs.data.map((s) => s.customer));

      const subIds = subs.data.map((s) => s.id);
      const { data: existingP } = subIds.length
        ? await supabase.from('pledges').select('stripe_subscription_id').in('stripe_subscription_id', subIds)
        : { data: [] };
      const existSet = new Set((existingP || []).map((p) => p.stripe_subscription_id));

      const statusMap = { active: 'active', trialing: 'active', past_due: 'active', unpaid: 'active', paused: 'paused', canceled: 'cancelled', incomplete: 'paused', incomplete_expired: 'cancelled' };
      const rows = [];
      for (const sub of subs.data) {
        if (existSet.has(sub.id)) continue;
        const item = sub.items.data[0];
        const anchor = new Date((sub.billing_cycle_anchor || sub.created) * 1000);
        rows.push({
          donor_id: donorMap[sub.customer?.id || sub.customer] || null,
          amount: (item?.price?.unit_amount || 0) / 100,
          frequency: 'monthly',
          method: 'stripe',
          billing_day: Math.min(28, Math.max(1, anchor.getDate())),
          start_date: new Date(sub.created * 1000).toISOString().split('T')[0],
          status: statusMap[sub.status] || 'active',
          stripe_subscription_id: sub.id,
          campaign_id: campaignId,
        });
      }
      if (rows.length) await supabase.from('pledges').insert(rows);

      const last = subs.data[subs.data.length - 1];
      return { statusCode: 200, body: JSON.stringify({ created: rows.length, hasMore: subs.has_more, nextCursor: last?.id || null }) };
    }

    // ─── שלב 2: תשלומים → תרומות ───
    if (phase === 'payments') {
      const charges = await stripe.charges.list({
        limit: PAGE, created: { gte: yearStart }, starting_after: cursor || undefined, expand: ['data.customer', 'data.invoice'],
      });
      const valid = charges.data.filter((ch) => ch.status === 'succeeded' && ch.paid && !ch.refunded);

      const stripeIds = valid.map((ch) => ch.payment_intent || ch.id);
      const { data: existingD } = stripeIds.length
        ? await supabase.from('donations').select('stripe_id').in('stripe_id', stripeIds)
        : { data: [] };
      const existSet = new Set((existingD || []).map((d) => d.stripe_id));

      const toInsert = valid.filter((ch) => !existSet.has(ch.payment_intent || ch.id));

      // הפרדה: חיובי Donorbox (לפי metadata) מטופלים בנפרד מחיובי Stripe רגילים
      const donorboxCharges = toInsert.filter((ch) => extractDonorboxMeta(ch.metadata));
      const plainCharges = toInsert.filter((ch) => !extractDonorboxMeta(ch.metadata));

      const donorMap = await resolveDonors(plainCharges.map((ch) => ch.customer));

      // קישור לפי מנוי → התחייבות (חיובי Stripe רגילים)
      const subIds = [...new Set(plainCharges.map((ch) => ch.invoice?.subscription).filter(Boolean))];
      const pledgeBySub = {};
      if (subIds.length) {
        const { data: pl } = await supabase.from('pledges').select('id,stripe_subscription_id').in('stripe_subscription_id', subIds);
        (pl || []).forEach((p) => { pledgeBySub[p.stripe_subscription_id] = p.id; });
      }

      const rows = plainCharges.map((ch) => ({
        donor_id: donorMap[ch.customer?.id || ch.customer] || null,
        amount: ch.amount / 100,
        campaign_id: campaignId,
        source: 'Stripe',
        date: new Date(ch.created * 1000).toISOString().split('T')[0],
        status: 'הושלם',
        stripe_id: ch.payment_intent || ch.id,
        pledge_id: ch.invoice?.subscription ? (pledgeBySub[ch.invoice.subscription] || null) : null,
      }));
      if (rows.length) await supabase.from('donations').insert(rows);

      // חיובי Donorbox — זיהוי/יצירת תורם+הו"ק+מגבית קבועה (בנפרד, כל שורה בתורה)
      let donorboxCreated = 0;
      if (donorboxCharges.length) {
        const donorboxCampaignId = await getOrCreateDonorboxCampaign();
        for (const ch of donorboxCharges) {
          const meta = extractDonorboxMeta(ch.metadata);
          const customerId = ch.customer?.id || ch.customer || null;
          const amount = ch.amount / 100;
          const donorId = await resolveDonorboxDonor(customerId, meta);
          const pledgeId = await resolveDonorboxPledge(donorId, meta, amount, donorboxCampaignId);
          await supabase.from('donations').insert({
            donor_id: donorId,
            amount,
            campaign_id: donorboxCampaignId,
            source: 'Donorbox',
            date: new Date(ch.created * 1000).toISOString().split('T')[0],
            status: 'הושלם',
            stripe_id: ch.payment_intent || ch.id,
            stripe_payment_intent_id: ch.payment_intent || null,
            stripe_customer_id: customerId,
            donor_email: meta.email,
            donor_name: meta.name,
            paid_at: new Date(ch.created * 1000).toISOString(),
            pledge_id: pledgeId,
          });
          donorboxCreated++;
        }
      }

      const last = charges.data[charges.data.length - 1];
      return { statusCode: 200, body: JSON.stringify({ created: rows.length + donorboxCreated, hasMore: charges.has_more, nextCursor: last?.id || null }) };
    }

    // ─── שלב 3: חישוב מחדש של סכומים ───
    if (phase === 'finalize') {
      await supabase.rpc('recompute_totals');
      return { statusCode: 200, body: JSON.stringify({ done: true }) };
    }

    return { statusCode: 400, body: JSON.stringify({ error: 'phase לא תקין' }) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
