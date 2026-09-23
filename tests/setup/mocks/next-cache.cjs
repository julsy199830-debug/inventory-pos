// revalidatePath is a Next.js request-scope API; a no-op is correct here —
// the actions call it purely to refresh cached Server Components.
module.exports = {
  revalidatePath() {},
  revalidateTag() {},
};
