import { getStoreSettings } from "@/app/actions/settings";
import SettingsForm from "./SettingsForm";

/**
 * Store Settings page.
 *
 * A Server Component: it reads the single (if any) settings row from the DB via
 * `getStoreSettings()` and hands it as props to the client `SettingsForm`. The
 * tuning knobs the manager can change here — store name/contact info, the sales-
 * tax rate, and the currency glyph — are intended to drive POS checkout and
 * receipts (today those are hardcoded constants; this page externalizes them).
 *
 * Unlike the suppliers page there's no table or filtering — settings are one
 * row, so this is a form page, not a list page. The `(dashboard)` route group is
 * folder-only, so the public path is `/settings` (the sidebar already links
 * here).
 *
 * When no settings row exists yet, we still render the form with sensible
 * defaults (the `SettingsForm` handles a `null` `settings` prop by prefilling
 * defaults), so the manager can set up the store on first visit rather than
 * staring at an empty state.
 */
export default async function SettingsPage() {
  const settings = await getStoreSettings();

  return (
    <div className="space-y-6">
      {/* Header */}
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">
          Store Settings
        </h1>
        <p className="text-sm text-zinc-500">
          Store-wide configuration that drives receipts and checkout.
          {settings && (
            <>
              {" "}
              Last edited{" "}
              <time
                dateTime={settings.updatedAt.toISOString()}
                className="font-medium text-zinc-900"
              >
                {settings.updatedAt.toLocaleDateString(undefined, {
                  year: "numeric",
                  month: "short",
                  day: "numeric",
                })}
              </time>
              .
            </>
          )}
        </p>
      </header>

      {/* Settings form. A client island: it manages submit/error state and calls
          the `saveSettings` Server Action, which upserts the singleton row and
          revalidates this page so the "last edited" stamp above refreshes. */}
      <SettingsForm settings={settings} />
    </div>
  );
}
