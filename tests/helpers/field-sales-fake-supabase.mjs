// A stand-in for the Supabase JS client that runs the SAME calls the app makes
// (rpc by name with named arguments, table selects with filters) against the
// in-memory test database, as a given signed-in user. It lets the real
// createSupabaseFieldSalesApi() be tested end to end against the real database
// functions and row-level security, without any network.
import { as, asAdmin } from './field-sales-db.mjs';

export function fakeSupabase(db, getUserId, options = {}) {
  const state = { online: true, failNext: null, calls: [], ...options };
  let queue = Promise.resolve();
  // One connection: run calls strictly one after another, each as the right user.
  const serial = fn => { const run = queue.then(fn, fn); queue = run.then(() => {}, () => {}); return run; };

  async function runAs(work) {
    return serial(async () => {
      const uid = getUserId();
      await as(db, uid);
      try { return { data: await work(), error: null, status: 200 }; }
      catch (error) { return { data: null, error: { message: error.message, code: error.code || '' }, status: 400 }; }
      finally { await asAdmin(db); }
    });
  }
  function guard(name) {
    state.calls.push(name);
    if (!state.online) throw new TypeError('Failed to fetch');
    if (state.failNext) { const failure = state.failNext; state.failNext = null; return failure; }
    return null;
  }

  return {
    state,
    auth: { getSession: async () => ({ data: { session: getUserId() ? { user: { id: getUserId() } } : null } }) },
    async rpc(name, args = {}) {
      const before = guard(`rpc:${name}`);
      if (before?.before) throw before.before;
      const result = await runAs(async () => {
        const meta = (await db.query(
          `SELECT p.proretset AS is_set, p.proargnames AS names, (SELECT array_agg(t::regtype::text ORDER BY ord) FROM unnest(p.proargtypes) WITH ORDINALITY AS u(t, ord)) AS types
           FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = $1`, [name])).rows[0];
        if (!meta) { const e = new Error(`Could not find the function public.${name} in the schema cache`); e.code = 'PGRST202'; throw e; }
        const keys = Object.keys(args);
        for (const key of keys) if (!(meta.names || []).includes(key)) { const e = new Error(`Could not find the function public.${name}(${keys.join(', ')}) in the schema cache`); e.code = 'PGRST202'; throw e; }
        const placeholders = keys.map((key, index) => `${key} => $${index + 1}::${meta.types[meta.names.indexOf(key)]}`);
        const values = keys.map(key => (args[key] !== null && typeof args[key] === 'object' ? JSON.stringify(args[key]) : args[key]));
        const rows = (await db.query(`SELECT to_jsonb(x) AS v FROM public.${name}(${placeholders.join(', ')}) AS x`, values)).rows.map(row => row.v);
        return meta.is_set ? rows : rows[0];
      });
      // "The server did the work but the reply never arrived."
      if (before?.afterSuccess && !result.error) throw before.afterSuccess;
      return result;
    },
    from(table) {
      const filters = []; let orderBy = ''; let max = '';
      const builder = {
        select() { return builder; },
        eq(column, value) { filters.push([column, value]); return builder; },
        order(column, { ascending = true } = {}) { orderBy = ` ORDER BY ${column} ${ascending ? 'ASC' : 'DESC'}`; return builder; },
        limit(n) { max = ` LIMIT ${Number(n)}`; return builder; },
        then(resolve, reject) {
          let attempt;
          try { guard(`select:${table}`); attempt = runAs(async () => {
            const where = filters.length ? ' WHERE ' + filters.map(([column], index) => `${column} = $${index + 1}`).join(' AND ') : '';
            return (await db.query(`SELECT to_jsonb(t) AS v FROM public.${table} t${where}${orderBy}${max}`, filters.map(([, value]) => value))).rows.map(row => row.v);
          }); } catch (error) { attempt = Promise.reject(error); }
          return attempt.then(resolve, reject);
        }
      };
      return builder;
    }
  };
}

/** localStorage stand-in. */
export function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    failWrites: false,
    getItem: key => (map.has(key) ? map.get(key) : null),
    setItem(key, value) { if (this.failWrites) throw new Error('QuotaExceededError'); map.set(key, String(value)); },
    removeItem: key => { map.delete(key); }
  };
}
