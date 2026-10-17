import {
  neon,
  Pool,
  type QueryResult,
  type QueryResultRow,
} from '@neondatabase/serverless';
import { Pool as PostgresPool } from 'pg';

type SqlPrimitive = string | number | boolean | undefined | null;
let sqlClient: ReturnType<typeof neon> | null = null;

export function sql(
  strings: TemplateStringsArray,
  ...values: SqlPrimitive[]
): ReturnType<ReturnType<typeof neon>> {
  const connectionString =
    process.env.POSTGRES_URL || process.env.POSTGRES_URL_NON_POOLING || '';
  if (!connectionString) {
    throw new Error('Provider database is not configured');
  }
  sqlClient ||= neon(connectionString);
  return sqlClient(strings, ...values);
}

type DatabaseQuery = <T extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]) => Promise<QueryResult<T>>;
interface DatabasePool {
  query: DatabaseQuery;
  connect(): Promise<{ query: DatabaseQuery; release(): void }>;
  end(): Promise<void>;
}
let pool: DatabasePool | null = null;

export async function dbQuery<T extends QueryResultRow = QueryResultRow>(
  text: string,
  values: unknown[] = []
): Promise<QueryResult<T>> {
  return getPool().query<T>(text, values);
}

function getPool(): DatabasePool {
  if (!isDatabaseConfigured()) {
    throw new Error('Provider database is not configured');
  }
  const PoolDriver = process.env.OPENTU_DATABASE_DRIVER === 'postgres' ? PostgresPool : Pool;
  pool ||= new PoolDriver({
    max: 5,
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 30000,
    connectionString:
      process.env.POSTGRES_URL || process.env.POSTGRES_URL_NON_POOLING,
  });
  return pool;
}

export async function dbTransaction<T>(
  work: (query: typeof dbQuery) => Promise<T>
): Promise<T> {
  const client = await getPool().connect();
  const query: typeof dbQuery = (text, values = []) =>
    client.query(text, values);
  try {
    await client.query('BEGIN');
    const result = await work(query);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

let schemaPromise: Promise<void> | null = null;
let migrationPromise: Promise<void> | null = null;
const SCHEMA_VERSION = '20260906-free-launch-v2';

export function isDatabaseConfigured(): boolean {
  return Boolean(
    process.env.POSTGRES_URL || process.env.POSTGRES_URL_NON_POOLING
  );
}

export async function ensureSchema(): Promise<void> {
  if (process.env.NODE_ENV !== 'production') return migrateSchema();
  if (!schemaPromise) {
    schemaPromise = dbQuery(
      'SELECT version FROM opentu_schema_migrations WHERE version = $1',
      [SCHEMA_VERSION]
    )
      .then((result) => {
        if (!result.rows.length)
          throw new Error('Database migration is required');
      })
      .catch((error) => {
        schemaPromise = null;
        throw error;
      });
  }
  return schemaPromise;
}

export async function migrateSchema(): Promise<void> {
  if (!isDatabaseConfigured()) {
    throw new Error('Provider database is not configured');
  }
  if (!migrationPromise) {
    migrationPromise = dbTransaction(async (query) => {
      await query(
        "SELECT pg_advisory_xact_lock(hashtext('opentu-schema-migration'))"
      );
      const sql = async (
        strings: TemplateStringsArray,
        ...values: SqlPrimitive[]
      ) => {
        const text = strings.reduce(
          (all, part, index) => all + (index ? `$${index}` : '') + part,
          ''
        );
        return query(text, values);
      };
      await sql`
        CREATE TABLE IF NOT EXISTS opentU_provider_profiles (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          base_url TEXT NOT NULL,
          auth_type TEXT NOT NULL DEFAULT 'bearer',
          auth_header TEXT,
          auth_query TEXT,
          extra_headers JSONB NOT NULL DEFAULT '{}'::jsonb,
          encrypted_api_key TEXT NOT NULL,
          enabled BOOLEAN NOT NULL DEFAULT TRUE,
          health_status TEXT NOT NULL DEFAULT 'unknown',
          health_message TEXT,
          last_checked_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS opentU_provider_models (
          id TEXT PRIMARY KEY,
          provider_id TEXT NOT NULL REFERENCES opentU_provider_profiles(id) ON DELETE CASCADE,
          model_id TEXT NOT NULL,
          name TEXT NOT NULL,
          vendor TEXT NOT NULL,
          category TEXT NOT NULL,
          description TEXT NOT NULL,
          tags JSONB NOT NULL DEFAULT '[]'::jsonb,
          accent TEXT NOT NULL DEFAULT 'cyan',
          available BOOLEAN NOT NULL DEFAULT TRUE,
          published BOOLEAN NOT NULL DEFAULT FALSE,
          last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE(provider_id, model_id)
        )
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS opentU_provider_models_public_idx
        ON opentU_provider_models(provider_id, available, published)
      `;
      await sql`
        ALTER TABLE opentU_provider_models
        ADD COLUMN IF NOT EXISTS gateway_enabled BOOLEAN NOT NULL DEFAULT FALSE
      `;
      await sql`
        ALTER TABLE opentU_provider_models
        ADD COLUMN IF NOT EXISTS billing_mode TEXT NOT NULL DEFAULT 'unconfigured'
      `;
      await sql`
        ALTER TABLE opentU_provider_models
        ADD COLUMN IF NOT EXISTS routing_priority INTEGER NOT NULL DEFAULT 100
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS opentU_provider_models_gateway_idx
        ON opentU_provider_models(model_id, category, gateway_enabled, routing_priority)
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS opentU_generation_tasks (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          user_role INTEGER NOT NULL DEFAULT 0,
          idempotency_key TEXT NOT NULL,
          request_hash TEXT NOT NULL,
          public_model_id TEXT NOT NULL,
          provider_model_record_id TEXT,
          provider_id TEXT,
          operation TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'queued',
          input_json JSONB NOT NULL DEFAULT '{}'::jsonb,
          parameters_json JSONB NOT NULL DEFAULT '{}'::jsonb,
          references_json JSONB NOT NULL DEFAULT '[]'::jsonb,
          context_json JSONB NOT NULL DEFAULT '{}'::jsonb,
          result_json JSONB,
          error_code TEXT,
          error_message TEXT,
          error_retryable BOOLEAN NOT NULL DEFAULT FALSE,
          upstream_task_id TEXT,
          upstream_status TEXT,
          attempt_count INTEGER NOT NULL DEFAULT 0,
          lease_token TEXT,
          lease_expires_at TIMESTAMPTZ,
          next_poll_at TIMESTAMPTZ,
          cancel_requested_at TIMESTAMPTZ,
          started_at TIMESTAMPTZ,
          completed_at TIMESTAMPTZ,
          billing_mode TEXT NOT NULL DEFAULT 'unconfigured',
          billable BOOLEAN NOT NULL DEFAULT FALSE,
          pricing_revision JSONB,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE(user_id, idempotency_key)
        )
      `;
      await sql`
        ALTER TABLE opentU_generation_tasks
        ADD COLUMN IF NOT EXISTS context_json JSONB NOT NULL DEFAULT '{}'::jsonb
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS opentU_generation_tasks_owner_idx
        ON opentU_generation_tasks(user_id, created_at DESC)
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS opentU_generation_tasks_status_idx
        ON opentU_generation_tasks(status, next_poll_at, lease_expires_at)
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS opentu_generation_tasks_created_idx
        ON opentu_generation_tasks(created_at)
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS opentU_generation_task_attempts (
          id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL REFERENCES opentU_generation_tasks(id) ON DELETE CASCADE,
          attempt_number INTEGER NOT NULL,
          provider_id TEXT,
          status TEXT NOT NULL,
          upstream_status INTEGER,
          error_code TEXT,
          started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          completed_at TIMESTAMPTZ,
          UNIQUE(task_id, attempt_number)
        )
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS opentU_generation_task_usage (
          task_id TEXT PRIMARY KEY REFERENCES opentU_generation_tasks(id) ON DELETE CASCADE,
          input_tokens BIGINT,
          output_tokens BIGINT,
          total_tokens BIGINT,
          generated_count INTEGER,
          duration_seconds NUMERIC,
          provider_usage JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS opentU_generation_billing_events (
          id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL REFERENCES opentU_generation_tasks(id) ON DELETE CASCADE,
          event_type TEXT NOT NULL,
          external_reference TEXT,
          amount NUMERIC,
          currency TEXT,
          payload JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE(task_id, event_type)
        )
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS opentU_generation_rate_limits (
          user_id TEXT NOT NULL,
          operation TEXT NOT NULL,
          bucket_start TIMESTAMPTZ NOT NULL,
          request_count INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY(user_id, operation, bucket_start)
        )
      `;
      await sql`CREATE TABLE IF NOT EXISTS opentu_schema_migrations (
        version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`;
      await sql`INSERT INTO opentu_schema_migrations (version) VALUES (${SCHEMA_VERSION})
        ON CONFLICT (version) DO NOTHING`;
    }).catch((error) => {
      migrationPromise = null;
      throw error;
    });
  }
  await migrationPromise;
}

export async function closeDatabase(): Promise<void> {
  if (pool) await pool.end();
  pool = null;
}

export function resetSchemaPromiseForTests(): void {
  schemaPromise = null;
  migrationPromise = null;
}
