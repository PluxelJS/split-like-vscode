---
"@worksplit/react": patch
---

# Preserve native tab names within a document identity

Keep native renames when restoring active or lazy background documents, reloading their Router,
or changing query/hash view state within the same content identity. Native Model JSON remains the
single title source, including names edited while restoration is loading. A different route owner,
path params or declared `identitySearch` value still applies the accepted route's default title.
