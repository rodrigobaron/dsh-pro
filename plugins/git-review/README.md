# The Git review tab

Reviews the session's repository — the working directory of the session you are
in, not a global one, so two sessions in different workspaces review different
repos.

The host half serves a small JSON API under `/git`. Because these routes can
**write** to a repository, two guards apply:

- **Containment** — the directory must resolve inside a registered workspace or
  the process cwd, and be a git work tree. The client sends the directory, but
  the host re-validates it, so a wrong or forged value cannot reach outside.
- **Same-origin** — mutating routes require a custom header, which a
  cross-origin page cannot set without a preflight the server never answers.
  Without this, any site you visited could commit or push through loopback.

Git is invoked with an explicit argv array, never a shell string, so a branch
name or path can never be reinterpreted as shell syntax.

Discarding changes and pushing both require a confirming second click that
names what is about to happen. Discard is irreversible — uncommitted work is
not recoverable afterwards — and the server accepts only explicit paths, never
a "discard everything" flag.

Staging is per file. Hunk-level staging is not implemented.
