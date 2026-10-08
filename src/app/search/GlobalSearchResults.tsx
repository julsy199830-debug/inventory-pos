"use client";

import { KIND_META, GROUP_ORDER } from "./search-meta";
import type { SearchGroups, SearchHit } from "./actions";

/** Grouped answer list: initial / loading / empty / error / grouped rows. */
export function GlobalSearchResults({
  status,
  groups,
  activeIndex,
  showNoResults,
  onGo,
  onHover,
}: {
  status: "idle" | "loading" | "error";
  groups: SearchGroups | null;
  activeIndex: number;
  showNoResults: boolean;
  onGo: (href: string) => void;
  onHover: (index: number) => void;
}) {
  if (status === "error") {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        <div className="px-4 py-10 text-center" data-testid="global-search-error">
          <p className="text-sm font-semibold text-slate-900">Search isn&apos;t working right now.</p>
          <p className="mt-1 text-sm text-slate-500">
            Check your connection and try again, or use the menu on the left.
          </p>
        </div>
      </div>
    );
  }
  if (groups === null) {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        <div className="px-4 py-10 text-center">
          <p className="text-sm font-semibold text-slate-900">Find anything in the store.</p>
          <p className="mt-1 text-sm text-slate-500">
            Try a name, product, transaction number, or page.
          </p>
        </div>
      </div>
    );
  }
  if (showNoResults) {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        <div className="px-4 py-10 text-center" data-testid="global-search-empty">
          <p className="text-sm font-semibold text-slate-900">No matches found.</p>
          <p className="mt-1 text-sm text-slate-500">
            Try a different name, product, or transaction number.
          </p>
        </div>
      </div>
    );
  }
  return (
    <div id="global-search-results" className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
      <ul role="listbox" aria-label="Search results" className="space-y-3 pb-1">
        {GROUP_ORDER.map(({ key, title }) => {
          const hits: SearchHit[] = groups[key];
          if (hits.length === 0) return null;
          let offset = 0;
          for (const g of GROUP_ORDER) {
            if (g.key === key) break;
            offset += groups[g.key].length;
          }
          return (
            <li key={key}>
              <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-widest text-slate-500">
                {title}
              </p>
              <ul className="space-y-0.5">
                {hits.map((hit, i) => {
                  const flatIndex = offset + i;
                  const meta = KIND_META[hit.kind];
                  const MetaIcon = meta.Icon;
                  const active = flatIndex === activeIndex;
                  return (
                    <li key={`${hit.kind}-${hit.href}-${hit.title}`}>
                      <button
                        type="button"
                        id={`global-search-option-${flatIndex}`}
                        role="option"
                        aria-selected={active}
                        data-testid="global-search-option"
                        data-active={active ? "true" : "false"}
                        onClick={() => onGo(hit.href)}
                        onMouseEnter={() => onHover(flatIndex)}
                        className={`flex min-h-[48px] w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors ${
                          active ? "bg-indigo-50" : "hover:bg-slate-50"
                        }`}
                      >
                        <span
                          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                            active
                              ? "bg-indigo-100 text-indigo-700"
                              : "bg-slate-100 text-slate-500"
                          }`}
                        >
                          <MetaIcon className="h-4 w-4" aria-hidden />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-slate-900">
                            {hit.title}
                          </span>
                          <span className="block truncate text-xs text-slate-500">
                            {hit.detail}
                          </span>
                        </span>
                        <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                          {meta.label}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
