// The existing order services use D1's prepared-statement API. This adapter
// keeps those services and their atomic batches intact on PostgreSQL.
import pg from 'pg';
const { Pool, types } = pg;

let pool;
export function postgresPool() {
  if (!pool) {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for the Render backend.');
    const connection = new URL(process.env.DATABASE_URL);
    // Enforce verification for external TLS connections; use the internal Render
    // URL without sslmode for same-region private networking.
    if (connection.searchParams.get('sslmode') === 'require') {
      connection.searchParams.set('sslmode', 'verify-full');
    }
    pool = new Pool({
      connectionString: connection.toString(), max: 5,
      connectionTimeoutMillis: 10000, idleTimeoutMillis: 30000,
      types: { getTypeParser(oid, format) {
        // COUNT/SUM(integer) are int8 in PostgreSQL, numbers in the existing API.
        if (oid === 20 && format !== 'binary') return (value) => {
          const number = Number(value);
          if (!Number.isSafeInteger(number)) throw new Error('Database integer exceeds the safe numeric range.');
          return number;
        };
        return types.getTypeParser(oid, format);
      } },
    });
    pool.on('error', () => console.error('An idle PostgreSQL connection failed.'));
  }
  return pool;
}

// Only the SQLite expressions used by the application are translated here.
// Values always remain bound parameters, including JSON values and search text.
export function postgresSql(source) {
  let sql = source.replace(/json_extract\(\s*([\w.]+)\s*,\s*'\$\.([\w.]+)'\s*\)/gi,
    (_, column, path) => `(${column}::jsonb #>> '{${path.split('.').join(',')}}')`);
  sql = sql.replace(/json_set\(\s*([\w.]+)\s*,\s*'\$\.([\w.]+)'\s*,\s*(\?|'(?:[^']|'')*')\s*\)/gi,
    (_, column, path, value) => `jsonb_set(${column}::jsonb, '{${path.split('.').join(',')}}', to_jsonb((${value})::text), true)::text`);
  // Split quoted literals/identifiers and comments so '?' inside text is untouched.
  let parameter = 0;
  sql = sql.split(/('(?:[^']|'')*'|"(?:[^"]|"")*"|--[^\n]*|\/\*[\s\S]*?\*\/)/g)
    .map((part, index) => index % 2 ? part : part.replace(/\?/g, () => `$${++parameter}`).replace(/\bLIKE\b/gi, 'ILIKE'))
    .join('');
  if (/^\s*INSERT\s+INTO\s+notifications\b/i.test(sql) && !/\bRETURNING\b/i.test(sql)) {
    sql = sql.replace(/;?\s*$/, ' RETURNING id');
  }
  return sql;
}

function resultOf(result) {
  return {
    success: true, results: result.rows,
    meta: { changes: result.rowCount ?? 0, last_row_id: result.rows[0]?.id ?? 0 },
  };
}
function normalizeError(error) {
  // Existing stock handlers recognise this D1 error and return HTTP 409.
  if (error.code === '23514') return new Error('CHECK constraint failed: stock or product price', { cause: error });
  return error;
}
class Statement {
  constructor(sql, values = []) { this.sql = sql; this.values = values; }
  bind(...values) { return new Statement(this.sql, values); }
  async execute(client) {
    return resultOf(await client.query(postgresSql(this.sql), this.values));
  }
  async all() {
    try { return await this.execute(postgresPool()); } catch (error) { throw normalizeError(error); }
  }
  async run() { return this.all(); }
  async first(column) {
    const result = await this.all();
    const first = result.results[0] ?? null;
    return column ? first?.[column] ?? null : first;
  }
}
const database = {
  prepare(sql) { return new Statement(sql); },
  async batch(statements) {
    const client = await postgresPool().connect();
    try {
      await client.query('BEGIN');
      // D1 serialises atomic batches. Preserve that ordering across Node workers
      // for conditional stock releases and payment finalisation as well.
      await client.query('SELECT pg_advisory_xact_lock(702401280)');
      const results = [];
      for (const statement of statements) results.push(await statement.execute(client));
      await client.query('COMMIT');
      return results;
    } catch (error) {
      await client.query('ROLLBACK');
      throw normalizeError(error);
    } finally { client.release(); }
  },
};
export function postgresDatabase() { return database; }
export async function closePostgres() {
  const current = pool; pool = undefined;
  if (current) await current.end();
}
