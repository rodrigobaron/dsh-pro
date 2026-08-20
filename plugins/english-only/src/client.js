// @my-dsh/english-only — browser half.
//
// English is the only interface language this deployment ships, so this does
// two things that belong together:
//
//   1. Pins the active locale to `en` and re-asserts it if anything changes it.
//      This is what actually guarantees English output: several plugins here
//      are repackaged from upstreams that carry Chinese dictionaries, and a
//      locale of `zh` would select them. Pinning the locale neutralizes every
//      such dictionary at once, including inside prebuilt bundles this
//      repository does not compile.
//
//   2. Removes the Language row from Settings, since a control that cannot
//      change anything is worse than no control.
//
// The row is owned by @deepseek-ai/dsh-client-locale, which registers it into
// the `settings.general.item` list slot under the id `language` at priority 0.
// The framework refuses a second entry with the same id at the SAME priority
// and points at the supported alternative: register lower, because the lowest
// priority renders. So this takes the seat at priority -10 with a component
// that draws nothing. Note `priority` is the shadowing field and is distinct
// from `order`, which only sequences rows that coexist.
const name = "@my-dsh/english-only";
const inject = ["locale", "slots"];

const LOCALE = "en";

/** Read the active locale id from whichever shape the runtime returns. */
function currentLocale(locale) {
  try {
    const snapshot = locale.getLocale?.() ?? locale.getSnapshot?.();
    if (typeof snapshot === "string") return snapshot;
    return snapshot?.id ?? snapshot?.locale ?? null;
  } catch {
    return null;
  }
}

/** A component that renders nothing, used to claim the language seat. */
function NoRow() {
  return null;
}

function apply(ctx) {
  // ---- pin the locale -----------------------------------------------------
  ctx.effect(() => {
    const enforce = () => {
      if (currentLocale(ctx.locale) !== LOCALE) {
        try {
          ctx.locale.setLocale(LOCALE);
        } catch {
          // A runtime that refuses the write leaves the UI on its own default;
          // the selector removal below still stands.
        }
      }
    };
    enforce();
    return ctx.locale.subscribe?.(enforce) ?? (() => {});
  }, "english-only: pin locale");

  // ---- claim the language seat -------------------------------------------
  ctx.slots.inject("settings.general.item", () =>
    ctx.slots.register(
      { name: "settings.general.item", id: "language", priority: -10 },
      NoRow,
    ),
  );
}

export { apply, inject, name };
