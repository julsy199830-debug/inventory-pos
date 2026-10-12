import { PageHeader } from "@/app/_components/ui/PageHeader";

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
      {/* Phase 7 Step 4: title → description → count → primary action. */}
      <PageHeader
        helpId="settings"
        title="Store Settings"
        description="Store-wide configuration that drives receipts and checkout."
        meta={
          settings ? (
            <>
              Last edited{" "}
              <time
                dateTime={settings.updatedAt.toISOString()}
                className="font-medium text-slate-900"
              >
                {settings.updatedAt.toLocaleDateString(undefined, {
                  year: "numeric",
                  month: "short",
                  day: "numeric",
                })}
              </time>
              .
            </>
          ) : (
            "Not saved yet — configure the store below."
          )
        }
      />

      {/* Settings form. A client island: it manages submit/error state and calls
          the `saveSettings` Server Action, which upserts the singleton row and
          revalidates this page so the "last edited" stamp above refreshes. */}
      <SettingsForm settings={settings} />
    </div>
  );
}
