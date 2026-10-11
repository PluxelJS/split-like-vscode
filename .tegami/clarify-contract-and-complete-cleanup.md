---
"@worksplit/react": patch
---

# Complete shutdown cleanup and clarify public ownership

Instance shutdown continues after Router cleanup failures, returns the collected errors and
shares one completion for repeated or reentrant disposal. Router abort, cache and history cleanup
are attempted independently. Candidate cleanup failures are reported without replacing the
original navigation receipt.

Workbench props and state selectors now express their existing runtime contract: supply the real
Workbench instance and read coordination fields without writing them. Host-defined Router types
remain assignable. No new controller, state facade or lifecycle protocol is introduced.

Usage now distinguishes active-document commands from originating-content commands, explains
identity without metadata, and makes failed registration and host shutdown ownership explicit.
The design entry describes current architecture rather than parallel prototype recommendations.
The complete initialization example declares a native index redirect instead of creating an
empty root-route document on startup.
