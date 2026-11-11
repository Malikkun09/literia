import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { rateLimit, resetRateLimits } from "../src/lib/rate-limit";

describe("rate limit unggah", () => {
  it("menolak setelah batas dalam jendela yang sama", () => {
    resetRateLimits();
    for (let i = 0; i < 3; i++) {
      assert.equal(rateLimit("user-a:init", 3, 60_000).ok, true);
    }
    const blocked = rateLimit("user-a:init", 3, 60_000);
    assert.equal(blocked.ok, false);
    if (!blocked.ok) assert.ok(blocked.retryAfterSec >= 1);
    assert.equal(rateLimit("user-b:init", 3, 60_000).ok, true);
  });
});
