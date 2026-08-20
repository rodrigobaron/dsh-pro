# Desktop notifications

`notification` raises a browser notification when a session finishes a turn, so
you can switch tabs and still know when DSH is done. The host half only
registers the `notification` session projection — a bounded summary of each
session's last completed turn; the browser half decides what to show and calls
the Notification API. **Settings -> Notifications** holds the per-outcome
toggles and the include/exclude keyword rules, and grants browser permission.

Two notes from porting it:

- **The tsconfig mirrors upstream's rather than this repository's stricter
  default.** Turning on `noUncheckedIndexedAccess` for code never written
  against it produced ten complaints that were style, not defects; silencing
  them one at a time would have turned a port into a rewrite.

- **One real type fix.** `observedTurn` was declared `Map<string, number>`
  while `state.ids` carries a branded `SessionId`, so it did not check against
  the harness actually installed here. The same file already uses
  `Map<SessionId, ...>` for the pending runner two functions down, so this was
  its own odd case out. Runtime behaviour is identical — a brand is erased —
  but this is exactly the drift that type-checking against the *running*
  harness is meant to catch, rather than against whatever a monorepo checkout
  happened to have.

## Diagnosing a notification that never appears

Two code paths used to produce an **empty console**, and they mean opposite
things: the browser accepted the notification and the OS dropped it, versus the
code never ran at all. Both now log, so one line in DevTools identifies which:

| Console line | Meaning |
| --- | --- |
| `test skipped: browser permission is "denied"` | Permission is not actually granted, whatever the panel shows. The settings section returns before ever calling `show()`. |
| `shown: <title> (tag=...)` | The browser constructed it successfully. If nothing appeared on screen, the block is below the browser — on macOS, **System Settings -> Notifications -> [browser]**, or a Focus mode. |
| `notification creation failed: ...` | The constructor threw; the message says why. |
| `turn N <session>: ... show=false (...)` | A completion was decided against. The line prints every input — permission, `backgroundOnly`, `hidden`, and which session is in view. |
| nothing at all | The completion never reached the runner: the host projection did not advance. |

The last row is the one that would indicate a real defect here; the others are
environment or settings.

The plugin also now claims its own `<style>` tag with `data-plugin`. Upstream
leaves it unset and the harness then attributes the stylesheet to whichever
plugin happened to be loading — it showed up in the DOM as `@dsh-pro/git-review`
owning the notification rules.
