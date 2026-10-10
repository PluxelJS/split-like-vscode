import { Actions, TabSetNode } from "flexlayout-react";

import type { integrationState } from "./integration";

/** A transient native maximize; snapshots retain the desktop preference. */
export function connectResponsiveLayout(
  internal: ReturnType<typeof integrationState>,
  element: HTMLElement,
  onNarrow: (narrow: boolean) => void,
) {
  let compact = false;
  let lastActive: string | null = null;
  const maximize = (id: string | null) => {
    const previous = internal.model.getMaximizedTabset()?.getId();
    if (previous === id) return;
    if (previous) internal.model.doAction(Actions.maximizeToggle(previous));
    if (id && internal.model.getNodeById(id) instanceof TabSetNode)
      internal.model.doAction(Actions.maximizeToggle(id));
  };
  const resize = () => {
    const next = element.clientWidth < 640;
    if (next && !compact)
      internal.desktopMaximized = internal.model.getMaximizedTabset()?.getId() ?? null;
    if (!next && compact) {
      maximize(internal.desktopMaximized ?? null);
      internal.desktopMaximized = undefined;
    }
    compact = next;
    onNarrow(next);
    if (next) {
      const active = internal.store.get().activeDocumentId;
      const group = active
        ? internal.model.getNodeById(active)?.getParent()
        : internal.model.getActiveTabset();
      if (group instanceof TabSetNode) maximize(group.getId());
    }
  };
  const observer = new ResizeObserver(resize);
  observer.observe(element);
  resize();
  const subscription = internal.store.subscribe((s) => {
    if (s.activeDocumentId !== lastActive) {
      lastActive = s.activeDocumentId;
      resize();
    }
  });
  return () => {
    observer.disconnect();
    subscription.unsubscribe();
    if (compact) {
      maximize(internal.desktopMaximized ?? null);
      internal.desktopMaximized = undefined;
    }
  };
}
