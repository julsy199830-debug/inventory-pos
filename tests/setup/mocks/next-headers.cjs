// Real `cookies()` needs request scope; this stub reads the test's cookie jar
// (a plain object on globalThis) with the same read surface session.ts uses.
module.exports = {
  async cookies() {
    const jar = globalThis.__PO_TEST_COOKIES__;
    if (!jar) {
      throw new Error(
        "po-action test harness: no cookie jar — set globalThis.__PO_TEST_COOKIES__ first",
      );
    }
    return {
      get(name) {
        return Object.prototype.hasOwnProperty.call(jar, name)
          ? { name, value: jar[name] }
          : undefined;
      },
      getAll() {
        return Object.entries(jar).map(([name, value]) => ({ name, value }));
      },
      set() {},
      delete() {},
    };
  },
  // `headers()` is request-scoped too. `pos/actions.ts` calls it only to derive
  // a best-effort client-IP key for the rate limiter, which already documents
  // that the header is spoofable and falls back when absent — so returning an
  // empty header store is the honest stub, and it keeps the limiter on its
  // "direct-client" path.
  async headers() {
    return new Map();
  },
};

