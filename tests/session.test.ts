import { describe, expect, it } from "vitest";
import { accessCodeForRoleSelection, normalizeStoredSession } from "../src/shared/session.js";

describe("stored session", () => {
  it("preserves a configured access code across page reloads", () => {
    expect(normalizeStoredSession({
      accessCode: "team-secret",
      role: "设计师",
      name: "Hale",
      userId: "Hale"
    })).toEqual({
      accessCode: "team-secret",
      role: "设计师",
      name: "Hale",
      userId: "Hale"
    });
  });

  it("keeps an opaque server session without requiring an access code", () => {
    expect(normalizeStoredSession({
      token: "session-token",
      role: "管理员",
      name: "Admin",
      userId: "Admin",
      expiresAt: "2026-07-17T00:00:00.000Z"
    })).toEqual({
      token: "session-token",
      role: "管理员",
      name: "Admin",
      userId: "Admin",
      expiresAt: "2026-07-17T00:00:00.000Z"
    });
  });

  it("accepts an operations session", () => {
    expect(normalizeStoredSession({
      token: "operations-token",
      role: "运营",
      name: "Ops",
      userId: "Ops"
    })).toMatchObject({ role: "运营", name: "Ops", userId: "Ops" });
  });

  it("rejects malformed stored sessions instead of crashing app startup", () => {
    expect(normalizeStoredSession({ role: "设计总监", name: "Legacy" })).toBeNull();
    expect(normalizeStoredSession("broken")).toBeNull();
  });

  it("does not carry the designer code into an administrator login", () => {
    expect(accessCodeForRoleSelection("管理员", "emke.de")).toBe("");
    expect(accessCodeForRoleSelection("设计师", "emke.de")).toBe("emke.de");
  });

  it("uses the standard access code when operations is selected", () => {
    expect(accessCodeForRoleSelection("运营", "emke.de")).toBe("emke.de");
  });
});
