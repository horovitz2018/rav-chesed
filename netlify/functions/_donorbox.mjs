import { supabase } from './_settings.mjs';

// מגבית קבועה אחת לכל תרומות ה-Donorbox (סימון בלבד — לא קשור לקטגוריית Donorbox המקורית)
const DONORBOX_CAMPAIGN_NAME = 'הו"ק חודשי';

// בדיקה אם ל-charge/payment_intent יש metadata של Donorbox
export function extractDonorboxMeta(metadata = {}) {
  if (!Object.keys(metadata).some((k) => k.startsWith('donorbox_'))) return null;
  return {
    recurring: metadata.donorbox_recurring_donation === 'true',
    formId: metadata.donorbox_form_id || null,
    firstName: metadata.donorbox_first_name || '',
    lastName: metadata.donorbox_last_name || '',
    name: metadata.donorbox_name || [metadata.donorbox_first_name, metadata.donorbox_last_name].filter(Boolean).join(' '),
    email: metadata.donorbox_email || null,
  };
}

export async function getOrCreateDonorboxCampaign() {
  const { data: existing } = await supabase.from('campaigns').select('id').eq('name', DONORBOX_CAMPAIGN_NAME).maybeSingle();
  if (existing) return existing.id;
  const { data: created } = await supabase
    .from('campaigns')
    .insert({ name: DONORBOX_CAMPAIGN_NAME, target: 0, raised: 0, category: 'Donorbox', audience_type: 'general' })
    .select('id').single();
  return created.id;
}

// מאתר תורם לפי stripe_customer_id, אחרת לפי אימייל, אחרת יוצר חדש
export async function resolveDonorboxDonor(customerId, meta) {
  if (customerId) {
    const { data } = await supabase.from('donors').select('id').eq('stripe_customer_id', customerId).maybeSingle();
    if (data) return data.id;
  }
  if (meta.email) {
    const { data } = await supabase.from('donors').select('id').eq('email', meta.email).maybeSingle();
    if (data) {
      if (customerId) await supabase.from('donors').update({ stripe_customer_id: customerId }).eq('id', data.id);
      return data.id;
    }
  }
  const { data: created } = await supabase
    .from('donors')
    .insert({
      name: meta.name || meta.email || 'תורם מ-Donorbox',
      first_name: meta.firstName || null,
      last_name: meta.lastName || null,
      email: meta.email || null,
      stripe_customer_id: customerId || null,
      total_donated: 0,
    })
    .select('id').single();
  return created.id;
}

// מאתר הו"ק קיימת לאותו תורם+טופס Donorbox, אחרת יוצר אחת
export async function resolveDonorboxPledge(donorId, meta, amount, campaignId) {
  if (!meta.recurring || !meta.formId) return null;
  const { data: existing } = await supabase.from('pledges').select('id').eq('donor_id', donorId).eq('donorbox_form_id', meta.formId).maybeSingle();
  if (existing) return existing.id;
  const { data: created } = await supabase
    .from('pledges')
    .insert({ donor_id: donorId, amount, method: 'stripe', status: 'active', billing_day: 1, campaign_id: campaignId, donorbox_form_id: meta.formId })
    .select('id').single();
  return created.id;
}
