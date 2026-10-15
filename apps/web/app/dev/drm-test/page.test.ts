import { afterEach, describe, expect, it, vi } from "vitest";

// /dev/drm-test (spike; D158; ADR 0032): not found unless DRM_TEST_PAGE_ENABLED is true, before anyone is looked up;
// signed-out visitors go to sign-in and come back; only owners and admins see it. The session is faked.
vi.mock("server-only", () => ({}));
const { getUser, role } = vi.hoisted(() => ({ getUser: vi.fn(), role: vi.fn() }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT ${to}`);
  },
}));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (k: string) => k }));
vi.mock("@/lib/supabase/server", () => ({
  supabaseForSession: async () => ({ region: "ca", supabase: { auth: { getUser } } }),
}));
vi.mock("@/lib/studio", () => ({
  currentStudio: async () => {
    const r = role();
    return r ? { id: "s1", name: "A", slug: "a", region: "ca", role: r } : null;
  },
}));
vi.mock("./drm-test", () => ({ DrmTest: () => null }));

const open = async () => (await import("./page")).default();

afterEach(() => {
  vi.unstubAllEnvs();
  getUser.mockReset();
  role.mockReset();
});

describe("/dev/drm-test", () => {
  it.each(["", "false", "1"])(
    "is not found when the flag is %j, before the session is read",
    async (v) => {
      vi.stubEnv("DRM_TEST_PAGE_ENABLED", v);
      await expect(open()).rejects.toThrow("NEXT_NOT_FOUND");
      expect(getUser).not.toHaveBeenCalled();
    },
  );

  it("sends someone signed out to sign in, and back", async () => {
    vi.stubEnv("DRM_TEST_PAGE_ENABLED", "true");
    getUser.mockResolvedValue({ data: { user: null } });
    await expect(open()).rejects.toThrow("NEXT_REDIRECT /sign-in?next=/dev/drm-test");
  });

  it.each([["photographer"], ["staff"], [null]])("is not found for %s", async (r) => {
    vi.stubEnv("DRM_TEST_PAGE_ENABLED", "true");
    getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    role.mockReturnValue(r);
    await expect(open()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it.each(["owner", "admin"])("renders for an %s", async (r) => {
    vi.stubEnv("DRM_TEST_PAGE_ENABLED", "true");
    getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    role.mockReturnValue(r);
    await expect(open()).resolves.toBeTruthy();
  });
});
