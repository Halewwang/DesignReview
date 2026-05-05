import fs from "node:fs";
import path from "node:path";
import { neon } from "@neondatabase/serverless";
import { AuditLog, DirectorDecision, OperationReview, ReviewFrame, ReviewIssue, ReviewResult, ReviewTask } from "./types";

export type Database = {
  tasks: ReviewTask[];
  frames: ReviewFrame[];
  results: ReviewResult[];
  issues: ReviewIssue[];
  operationReviews: OperationReview[];
  directorDecisions: DirectorDecision[];
  logs: AuditLog[];
};

const storeKey = "reviews";
let schemaReadyForUrl: string | undefined;

export const createEmptyDb = (): Database => ({
  tasks: [],
  frames: [],
  results: [],
  issues: [],
  operationReviews: [],
  directorDecisions: [],
  logs: []
});

export function uid(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function now() {
  return new Date().toISOString();
}

export function getStorageMode() {
  return databaseUrl() ? "neon" : "json";
}

function databaseUrl() {
  return process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.POSTGRES_PRISMA_URL;
}

function dataDir() {
  return path.resolve(process.cwd(), "data");
}

function dbPath() {
  return process.env.REVIEWS_DB_PATH || path.join(dataDir(), "reviews.json");
}

async function ensureNeonSchema(url: string) {
  if (schemaReadyForUrl === url) return;
  const sql = neon(url);
  await sql`
    create table if not exists emke_design_review_store (
      key text primary key,
      value jsonb not null,
      updated_at timestamptz not null default now()
    )
  `;
  schemaReadyForUrl = url;
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
    await ensureNeonSchema(url);
    const sql = neon(url);
    const rows = await sql`select value from emke_design_review_store where key = ${key} limit 1`;
    return rows[0]?.value as T | undefined;
  }

  const targetPath = dbPath();
  const targetDir = path.dirname(targetPath);
  if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
  if (!fs.existsSync(targetPath)) {
    fs.writeFileSync(targetPath, JSON.stringify(createEmptyDb(), null, 2));
  }
  if (key !== storeKey) return undefined;
  return JSON.parse(fs.readFileSync(targetPath, "utf8")) as T;
}

export async function writeStoreValue(key: string, value: unknown) {
  const url = databaseUrl();
  if (url) {
    await ensureNeonSchema(url);
    const sql = neon(url);
    await sql`
      insert into emke_design_review_store (key, value, updated_at)
      values (${key}, ${JSON.stringify(value)}::jsonb, now())
      on conflict (key) do update set value = excluded.value, updated_at = now()
    `;
    return;
  }

  if (key !== storeKey) return;
  const targetPath = dbPath();
  const targetDir = path.dirname(targetPath);
  if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
  fs.writeFileSync(targetPath, JSON.stringify(value, null, 2));
}

export async function mutateDb<T>(mutator: (db: Database) => T | Promise<T>): Promise<T> {
  const db = await readDb();
  const result = await mutator(db);
  await writeDb(db);
  return result;
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
    logs: Array.isArray(db.logs) ? db.logs : []
  };
}
