---
"@worksplit/react": patch
---

# Preserve bulk close guards when revision access disappears

Reject the complete native deletion batch if a previously approved content lifecycle withdraws
its `getCloseRevision` capability while another close decision is pending. Keep every document,
native node and resource alive, returning the existing `rejected / changed` receipt. Dirty bulk
close without an initial editing revision still returns `rejected / revision-required` before
requesting application decisions.
