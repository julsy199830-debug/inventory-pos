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
      // FAITHFUL delete: removes the key from the jar.
      //
      // This used to be a no-op, which quietly made the jar read-only. That hid
      // a real class of test: any action whose correctness depends on the
      // session being GONE on a second call (e.g. `lockRegister` writing exactly
      // one LOGOUT audit row on a double-click) would have appeared to work
      // only because the cookie never actually cleared. `clearCashierCookie()`
      // is the production code under test, so the stub has to do it too.
      delete(name) {
        delete jar[name];
      },
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

