import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import ws from 'ws';

// לקוח Supabase עם service_role — לקריאת ההגדרות וכתיבת נתונים (עוקף RLS)
// מספקים transport מפורש כדי שלא יידרש WebSocket מובנה בזמן-ריצה
export const supabase = createClient(
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: { persistSession: false },
    realtime: { transport: ws },
  },
);

// שליפת הגדרות הארגון (לא-סודי)
export async function getSettings() {
  const { data } = await supabase.from('app_settings').select('*').limit(1).maybeSingle();
  return data || {};
}

// שליפת המפתחות הסודיים — נגיש רק לשרת (service_role עוקף RLS)
export async function getSecrets() {
  const { data } = await supabase.from('app_secrets').select('*').limit(1).maybeSingle();
  return data || {};
}

// מחזיר מופע Stripe לפי המפתח הסודי השמור (או null אם לא הוגדר)
export async function getStripe() {
  const secrets = await getSecrets();
  const key = secrets.stripe_secret_key;
  return { stripe: key ? new Stripe(key) : null, secrets };
}
