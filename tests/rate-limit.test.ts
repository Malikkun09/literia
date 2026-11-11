import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { clientAddress } from "../src/lib/client-ip";
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

  it("tidak menghapus jendela aktif saat peta penuh", () => {
    resetRateLimits();
    assert.equal(rateLimit("keep", 2, 60_000).ok, true);
    for (let i = 0; i < 9_999; i += 1) {
      assert.equal(rateLimit(`noise-${i}`, 1, 60_000).ok, true);
    }
    assert.equal(rateLimit("stranger", 1, 60_000).ok, false);
    assert.equal(rateLimit("keep", 2, 60_000).ok, true);
    assert.equal(rateLimit("keep", 2, 60_000).ok, false);
  });
});

describe("alamat klien", () => {
  it("mengabaikan hop X-Forwarded-For yang dikirim pemanggil", () => {
    const headers = new Headers({
      "x-forwarded-for": "1.2.3.4, 203.0.113.8",
      "cf-connecting-ip": "198.51.100.10",
    });
    assert.equal(clientAddress(headers), "198.51.100.10");
    const proxied = new Headers({ "x-forwarded-for": "1.2.3.4, 203.0.113.8" });
    assert.equal(clientAddress(proxied), "203.0.113.8");
  });
});
