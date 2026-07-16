export type ClientRole = "设计师" | "管理员";

export type StoredSession = {
  token?: string;
  accessCode?: string;
  role: ClientRole;
  name: string;
  userId?: string;
  expiresAt?: string;
};

export function accessCodeForRoleSelection(role: ClientRole, designerAccessCode: string) {
  return role === "管理员" ? "" : designerAccessCode;
}

export function normalizeStoredSession(value: unknown): StoredSession | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Partial<StoredSession>;
  if (input.role !== "设计师" && input.role !== "管理员") return null;
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const token = typeof input.token === "string" ? input.token.trim() : "";
  const accessCode = typeof input.accessCode === "string" ? input.accessCode : "";
  if (!name || (!token && !accessCode)) return null;

  const session: StoredSession = { role: input.role, name };
  if (token) session.token = token;
  if (accessCode) session.accessCode = accessCode;
  if (typeof input.userId === "string" && input.userId.trim()) session.userId = input.userId.trim();
  if (typeof input.expiresAt === "string" && input.expiresAt.trim()) session.expiresAt = input.expiresAt.trim();
  return session;
}
