# Where this skill comes from

Vendored copy of Cloudflare's security-audit skill (MIT, licence in `LICENSE`):
https://github.com/cloudflare/security-audit-skill, `skills/security-audit` at commit
`c1c8a8c1471069fb0e188eeaff69b8e8db6564a8` (2026-09-14). Files are unchanged apart from
this note and the copied `LICENSE`.

Claude Code picks it up from `.claude/skills/` in any session on this repo, on the Mac or
in claude.ai. Ask for "a security audit of this codebase" for the full multi-agent audit
(it uses a lot of tokens), or ask a focused security question for guidance mode. Full
audits write their reports outside the repo, to `~/security-audit-skill/<repo>/run-<N>`.

To update: copy `skills/security-audit` from the latest commit over this folder, keep
this note, and change the commit above.
