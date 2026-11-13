import type { AnyRouter, ParsedLocation } from "@tanstack/react-router";

import type { ReadingSize } from "./types";

export function checkReadingSize(size: ReadingSize | undefined): ReadingSize | undefined {
  if (size === undefined) return undefined;
  if (
    !size ||
    !Number.isFinite(size.minWidth) ||
    size.minWidth <= 0 ||
    (size.preferredWidth !== undefined &&
      (!Number.isFinite(size.preferredWidth) || size.preferredWidth < size.minWidth)) ||
    (size.minHeight !== undefined && (!Number.isFinite(size.minHeight) || size.minHeight <= 0))
  )
    throw new TypeError(
      "Reading sizes require positive finite minima and a preferred width at least minWidth",
    );
  return size;
}

export function sameReadingSize(a: ReadingSize | undefined, b: ReadingSize | undefined): boolean {
  return (
    a?.minWidth === b?.minWidth &&
    a?.preferredWidth === b?.preferredWidth &&
    a?.minHeight === b?.minHeight
  );
}

/** Resolve the deepest route declaration against committed, validated route parameters. */
export function resolveRouteReadingSize(
  router: AnyRouter,
  location: ParsedLocation = router.state.resolvedLocation ?? router.state.location,
): ReadingSize | undefined {
  const match = router
    .matchRoutes(location)
    .toReversed()
    .find((candidate) => candidate.staticData?.worksplit?.readingSize !== undefined);
  const declaration = match?.staticData.worksplit?.readingSize;
  if (declaration === undefined) return undefined;
  const size =
    typeof declaration === "function"
      ? declaration({ params: match!.params, search: match!.search, location })
      : declaration;
  if (size === undefined)
    throw new TypeError("A readingSize declaration must return content needs");
  return checkReadingSize(size);
}
