import { supabase } from './_settings.mjs';

// שמירת מפתחות Stripe לטבלת הסודות — רק למשתמש מחובר.
// המפתחות נכתבים דרך service_role ואינם נקראים לעולם חזרה לדפדפן.
export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  // אימות שהקורא מחובר (JWT מ-Supabase)
  const token = (event.headers.authorization || '').replace('Bearer ', '');
  const { data: { user } = {} } = await supabase.auth.getUser(token);
  if (!user) return { statusCode: 401, body: JSON.stringify({ error: 'נדרשת התחברות' }) };

  try {
    const { stripeSecretKey, stripeWebhookSecret } = JSON.parse(event.body || '{}');
    const patch = { updated_at: new Date().toISOString() };
    if (stripeSecretKey) patch.stripe_secret_key = stripeSecretKey.trim();
    if (stripeWebhookSecret) patch.stripe_webhook_secret = stripeWebhookSecret.trim();
    if (!patch.stripe_secret_key && !patch.stripe_webhook_secret) {
      return { statusCode: 400, body: JSON.stringify({ error: 'לא הוזנו מפתחות' }) };
    }

    const { data: secretRow } = await supabase.from('app_secrets').select('id').limit(1).maybeSingle();
    if (secretRow) await supabase.from('app_secrets').update(patch).eq('id', secretRow.id);
    else await supabase.from('app_secrets').insert(patch);

    // סימון שהחיבור פעיל (שדה לא-סודי שהדפדפן כן רואה)
    const { data: settingRow } = await supabase.from('app_settings').select('id').limit(1).maybeSingle();
    if (settingRow) await supabase.from('app_settings').update({ stripe_enabled: true }).eq('id', settingRow.id);

    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
