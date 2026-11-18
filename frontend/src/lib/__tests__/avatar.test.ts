import { beforeEach, describe, expect, it, vi } from "vitest";

const bucket = vi.hoisted(() => ({
  list: vi.fn(),
  remove: vi.fn(),
}));
const from = vi.hoisted(() => vi.fn(() => bucket));

vi.mock("../supabase", () => ({ supabase: { storage: { from } } }));

import { removeAvatar } from "../api";

const USER = "10000000-0000-0000-0000-000000000002";

describe("removeAvatar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    bucket.remove.mockResolvedValue({ data: [], error: null });
  });

  it("deletes every file in the user's avatars folder", async () => {
    bucket.list.mockResolvedValue({
      data: [{ name: "avatar.png" }, { name: "avatar.jpg" }],
      error: null,
    });

    await removeAvatar(USER);

    expect(from).toHaveBeenCalledWith("avatars");
    expect(bucket.list).toHaveBeenCalledWith(USER);
    expect(bucket.remove).toHaveBeenCalledWith([
      `${USER}/avatar.png`,
      `${USER}/avatar.jpg`,
    ]);
  });

  it("does nothing when the folder is already empty", async () => {
    bucket.list.mockResolvedValue({ data: [], error: null });

    await removeAvatar(USER);

    expect(bucket.remove).not.toHaveBeenCalled();
  });

  it("surfaces storage errors so the profile is not cleared", async () => {
    const failure = new Error("permission denied");
    bucket.list.mockResolvedValue({
      data: [{ name: "avatar.png" }],
      error: null,
    });
    bucket.remove.mockResolvedValue({ data: null, error: failure });

    await expect(removeAvatar(USER)).rejects.toBe(failure);
  });
});
