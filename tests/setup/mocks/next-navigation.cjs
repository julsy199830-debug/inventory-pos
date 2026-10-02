// Minimal `next/navigation` stub for Server Action unit tests.
//
// `redirect()` in the real framework THROWS a tagged error rather than
// returning, so a test that calls an action which redirects has to catch it.
// This reproduces that (including the `digest` shape) so tests can assert the
// destination instead of pretending the call returned normally.
module.exports = {
  redirect(url) {
    const error = new Error(`NEXT_REDIRECT:${url}`);
    error.digest = `NEXT_REDIRECT;replace;${url};307;`;
    throw error;
  },
  permanentRedirect(url) {
    const error = new Error(`NEXT_REDIRECT:${url}`);
    error.digest = `NEXT_REDIRECT;permanent;${url};308;`;
    throw error;
  },
  notFound() {
    const error = new Error("NEXT_NOT_FOUND");
    error.digest = "NEXT_NOT_FOUND";
    throw error;
  },
  usePathname() {
    return "/";
  },
  useRouter() {
    return { push() {}, replace() {}, refresh() {}, back() {} };
  },
  useSearchParams() {
    return new URLSearchParams();
  },
};