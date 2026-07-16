import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import postgres from "postgres";
import type { Sql } from "postgres";
import { AuditLog, DirectorDecision, OperationReview, ReviewFrame, ReviewIssue, ReviewJob, ReviewResult, ReviewSession, ReviewTask } from "./types.js";

export type Database = {
  tasks: ReviewTask[];
  frames: ReviewFrame[];
  results: ReviewResult[];
  issues: ReviewIssue[];
  operationReviews: OperationReview[];
  directorDecisions: DirectorDecision[];
  logs: AuditLog[];
  sessions: ReviewSession[];
  jobs: ReviewJob[];
};

const storeKey = "reviews";
let schemaReadyForUrl: string | undefined;
let cachedSql: { url: string; sql: Sql } | undefined;
let mutationQueue: Promise<unknown> = Promise.resolve();
const postgresTimeoutMs = 8000;

export const createEmptyDb = (): Database => ({
  tasks: [],
  frames: [],
  results: [],
  issues: [],
  operationReviews: [],
  directorDecisions: [],
  logs: [],
  sessions: [],
  jobs: []
});

export function uid(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function now() {
  return new Date().toISOString();
}

export function getStorageMode() {
  return databaseUrl() ? "postgres" : "json";
}

export function isDurableStorage() {
  return getStorageMode() === "postgres" || process.env.VERCEL !== "1";
}

function databaseUrl() {
  return configuredUrl(process.env.DATABASE_URL) || configuredUrl(process.env.POSTGRES_URL) || configuredUrl(process.env.POSTGRES_PRISMA_URL);
}

function configuredUrl(value: string | undefined) {
  const normalized = value?.trim();
  if (!normalized || normalized === "\"\"" || normalized === "''") return undefined;
  return normalized;
}

function dataDir() {
  return path.resolve(process.cwd(), "data");
}

function dbPath() {
  if (process.env.REVIEWS_DB_PATH) return process.env.REVIEWS_DB_PATH;
  if (process.env.VERCEL === "1") return path.join(os.tmpdir(), "emke-design-review", "reviews.json");
  return bundledDbPath();
}

function bundledDbPath() {
  return path.join(dataDir(), "reviews.json");
}

function initialJsonDb(targetPath: string) {
  const seedPath = bundledDbPath();
  if (path.resolve(seedPath) !== path.resolve(targetPath) && fs.existsSync(seedPath)) {
    return normalizeDb(JSON.parse(fs.readFileSync(seedPath, "utf8")));
  }
  return createEmptyDb();
}

async function ensurePostgresSchema(url: string) {
  if (schemaReadyForUrl === url) return;
  const sql = getPostgresClient(url);
  await withPostgresTimeout(sql`
    create table if not exists emke_design_review_store (
      key text primary key,
      value jsonb not null,
      updated_at timestamptz not null default now()
    )
  `);
  schemaReadyForUrl = url;
}

function getPostgresClient(url: string) {
  if (cachedSql?.url === url) return cachedSql.sql;
  const sql = postgres(url, {
    max: 1,
    prepare: false,
    fetch_types: false,
    ssl: "require",
    idle_timeout: 5,
    connect_timeout: 4
  });
  cachedSql = { url, sql };
  return sql;
}

export async function readDb(): Promise<Database> {
  return normalizeDb((await readStoreValue(storeKey)) ?? undefined);
}

export async function writeDb(db: Database) {
  await writeStoreValue(storeKey, normalizeDb(db));
}

export async function readStoreValue<T>(key: string): Promise<T | undefined> {
  const url = databaseUrl();
  if (url) {
    await ensurePostgresSchema(url);
    const sql = getPostgresClient(url);
    const rows = await withPostgresTimeout(sql`select value from emke_design_review_store where key = ${key} limit 1`);
    return rows[0]?.value as T | undefined;
  }

  const targetPath = dbPath();
  const targetDir = path.dirname(targetPath);
  if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
  if (!fs.existsSync(targetPath)) {
    fs.writeFileSync(targetPath, JSON.stringify(initialJsonDb(targetPath), null, 2));
  }
  if (key !== storeKey) return undefined;
  return JSON.parse(fs.readFileSync(targetPath, "utf8")) as T;
}

export async function writeStoreValue(key: string, value: unknown) {
  assertDurableMutationStorage();
  const url = databaseUrl();
  if (url) {
    await ensurePostgresSchema(url);
    const sql = getPostgresClient(url);
    await withPostgresTimeout(sql`
      insert into emke_design_review_store (key, value, updated_at)
      values (${key}, ${sql.json(value as postgres.JSONValue)}, now())
      on conflict (key) do update set value = excluded.value, updated_at = now()
    `);
    return;
  }

  if (key !== storeKey) return;
  const targetPath = dbPath();
  const targetDir = path.dirname(targetPath);
  if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
  fs.writeFileSync(targetPath, JSON.stringify(value, null, 2));
}

async function withPostgresTimeout<T>(operation: Promise<T>): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("数据库连接超时，请检查 Supabase DATABASE_URL 或连接池状态")), postgresTimeoutMs);
      })
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function mutateDb<T>(mutator: (db: Database) => T | Promise<T>): Promise<T> {
  assertDurableMutationStorage();
  const url = databaseUrl();
  if (url) {
    await ensurePostgresSchema(url);
    const sql = getPostgresClient(url);
    const transactionResult = await withPostgresTimeout(sql.begin(async (transactionSql) => {
      await transactionSql`select pg_advisory_xact_lock(hashtext(${storeKey}))`;
      const rows = await transactionSql`select value from emke_design_review_store where key = ${storeKey} limit 1 for update`;
      const db = normalizeDb(rows[0]?.value);
      const result = await mutator(db);
      await transactionSql`
        insert into emke_design_review_store (key, value, updated_at)
        values (${storeKey}, ${transactionSql.json(normalizeDb(db) as postgres.JSONValue)}, now())
        on conflict (key) do update set value = excluded.value, updated_at = now()
      `;
      return result;
    }));
    return transactionResult as T;
  }
  const runMutation = async () => {
    const db = await readDb();
    const result = await mutator(db);
    await writeDb(db);
    return result;
  };
  const result = mutationQueue.then(runMutation, runMutation);
  mutationQueue = result.catch(() => undefined);
  return result;
}

function assertDurableMutationStorage() {
  if (!isDurableStorage()) {
    throw new Error("生产环境未配置持久数据库，已拒绝写入以避免审核任务丢失");
  }
}

function normalizeDb(input: unknown): Database {
  const db = (input && typeof input === "object" ? input : {}) as Partial<Database>;
  return {
    ...createEmptyDb(),
    ...db,
    tasks: Array.isArray(db.tasks) ? db.tasks : [],
    frames: Array.isArray(db.frames) ? db.frames : [],
    results: Array.isArray(db.results) ? db.results : [],
    issues: Array.isArray(db.issues) ? db.issues : [],
    operationReviews: Array.isArray(db.operationReviews) ? db.operationReviews : [],
    directorDecisions: Array.isArray(db.directorDecisions) ? db.directorDecisions : [],
    logs: Array.isArray(db.logs) ? db.logs : [],
    sessions: Array.isArray(db.sessions) ? db.sessions : [],
    jobs: Array.isArray(db.jobs) ? db.jobs : []
  };
}
