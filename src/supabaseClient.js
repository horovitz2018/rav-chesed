import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !key) {
  console.error('חסרים פרטי Supabase. ודא שקובץ .env מכיל VITE_SUPABASE_URL ו-VITE_SUPABASE_ANON_KEY');
}

export const supabase = createClient(url, key);
