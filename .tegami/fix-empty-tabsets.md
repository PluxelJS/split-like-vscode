---
"@worksplit/react": patch
---

# Clean up emptied native split containers

Use FlexLayout's default empty-TabSet cleanup instead of globally retaining every empty split.
Moving the last tab removes the source container; FlexLayout still provides one empty main root
after closing all central content. Container ids are native layout identities, not permanent regions.

Reject document admission into a pruned target even when FlexLayout's initial idMap still contains
the old node. The demo creates side-by-side content with native Actions and current container ids.
Explicit application and saved-snapshot native settings that retain empty TabSets remain honored.
