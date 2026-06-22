import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

// לקוח Supabase עם service_role — לקריאת ההגדרות וכתיבת נתונים (עוקף RLS)
export const supabase = createClient(
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

// שליפת הגדרות הארגון (שורה יחידה כרגע)
export async function getSettings() {
  const { data } = await supabase.from('app_settings').select('*').limit(1).maybeSingle();
  return data || {};
}

// מחזיר מופע Stripe לפי המפתח השמור ב-DB (או null אם לא הוגדר)
export async function getStripe() {
  const settings = await getSettings();
  const key = settings.stripe_secret_key;
  return { stripe: key ? new Stripe(key) : null, settings };
}
