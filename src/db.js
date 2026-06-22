import { supabase } from './supabaseClient.js';

// ─── המרה בין camelCase (אפליקציה) ל-snake_case (בסיס נתונים) ───
const toSnake = (str) => str.replace(/[A-Z]/g, (m) => '_' + m.toLowerCase());
const toCamel = (str) => str.replace(/_([a-z])/g, (_, c) => c.toUpperCase());

const rowToApp = (row) => {
  if (!row) return row;
  const out = {};
  for (const k in row) {
    if (k === 'created_at') continue; // לא נחוץ באפליקציה
    out[toCamel(k)] = row[k];
  }
  return out;
};

const appToRow = (obj) => {
  const out = {};
  for (const k in obj) {
    if (k === 'createdAt') continue;
    out[toSnake(k)] = obj[k];
  }
  return out;
};

// ─── פעולות גנריות ───
export async function fetchTable(table) {
  const { data, error } = await supabase.from(table).select('*').order('created_at', { ascending: true });
  if (error) throw error;
  return data.map(rowToApp);
}

export async function insertRow(table, obj) {
  const payload = appToRow(obj);
  delete payload.id; // ה-DB מייצר מזהה
  const { data, error } = await supabase.from(table).insert(payload).select().single();
  if (error) throw error;
  return rowToApp(data);
}

export async function insertRows(table, objs) {
  const payload = objs.map((o) => { const r = appToRow(o); delete r.id; return r; });
  const { data, error } = await supabase.from(table).insert(payload).select();
  if (error) throw error;
  return data.map(rowToApp);
}

export async function updateRow(table, id, patch) {
  const { data, error } = await supabase.from(table).update(appToRow(patch)).eq('id', id).select().single();
  if (error) throw error;
  return rowToApp(data);
}

export async function deleteRow(table, id) {
  const { error } = await supabase.from(table).delete().eq('id', id);
  if (error) throw error;
}

export async function deleteAllRows(table) {
  const { error } = await supabase.from(table).delete().neq('id', '00000000-0000-0000-0000-000000000000');
  if (error) throw error;
}

export const TABLES = ['fundraisers', 'donors', 'campaigns', 'recipients', 'requests', 'expenses', 'donations', 'pledges'];
