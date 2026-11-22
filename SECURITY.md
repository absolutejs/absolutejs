# Security policy

## Reporting a vulnerability

**Please do not open a public issue for a security problem.**

Report it privately through GitHub: open the repository's
[**Security** tab](https://github.com/absolutejs/absolutejs/security) and use
**Report a vulnerability**. That creates a draft advisory only the maintainers
can see, keeps the details out of the issue tracker while a fix is prepared,
and gives the report a GHSA identifier to reference later.

If that button is not available to you, open an issue that says only that you
have a security report and asks for a private channel — **no details, no
reproduction** — and a maintainer will open one.

What helps, in the advisory rather than in public:

- the version you are on (`absolute --version`), and whether a newer one still
  has it;
- which part of the framework is involved — the image endpoint, the build, the
  dev server, form actions, the mobile shell, a page handler;
- the smallest reproduction you have, and what an attacker gets out of it.

## What to expect

This is a small project — a single-digit number of maintainers — so reports are
handled on a best-effort basis rather than against a published response time.
You will get an acknowledgement, a decision on whether it is a vulnerability
and, if it is, a fix and a release. Coordinated disclosure is preferred: the
advisory is published when the fix is out.

Credit is given in the advisory unless you ask otherwise.

## Supported versions

| Version                | Supported |
| ---------------------- | --------- |
| Latest `0.20.0-beta.*` | Yes       |
| Any earlier prerelease | No        |

AbsoluteJS has not reached 1.0 and has no long-term support branch: fixes land
in a new prerelease rather than being backported, which means **the only
supported version is the most recent one**. `absolute upgrade` reports the
migrations between the version you have and a newer one, including the ones a
person has to make.

A deprecation and support policy is part of the work toward 1.0 and does not
exist yet; this table is the whole of it today.

## Fixes already shipped

Security fixes are recorded in [`CHANGELOG.md`](./CHANGELOG.md) under the
release that shipped them, with what was wrong and what changed — for example
the image endpoint being restricted to the build directory, the pre-render
bypass header requiring a token, signed form-action result cookies and CSRF
tokens, `secureHeaders()` gaining COOP, CORP and HSTS, and a build-time floor
on a vulnerable React Flight range.

If you are reading this to decide whether a problem you have found is already
known, searching `CHANGELOG.md` for the area is the fastest route.
