import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import ws from 'ws';

// לקוח Supabase עם service_role — לכתיבת נתונים מצד השרת (עוקף RLS)
export const supabase = createClient(
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: { persistSession: false },
    realtime: { transport: ws },
  },
);

// מפתחות Stripe מגיעים ממשתני סביבה בלבד — לעולם לא מהדאטהבייס
export function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  return { stripe: key ? new Stripe(key) : null };
}

// כתובת האתר (לבניית כתובות חזרה מ-Checkout)
export function getSiteUrl(event) {
  return process.env.SITE_URL || event?.headers?.origin || `https://${event?.headers?.host}`;
}
