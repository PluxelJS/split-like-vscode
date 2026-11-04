import type {
  HistoryNavigation,
  HistoryNavigationOutcome,
  HistoryNavigationResult,
  MemoryHistory,
} from "@tanstack/history";
import { createMemoryHistory, createRootRoute, createRouter } from "@tanstack/react-router";
import { Actions, Layout, Model, type ILayoutApi, type ILayoutProps } from "flexlayout-react";
import { createRef } from "react";

const model = Model.fromJson({ layout: { type: "row", children: [] } });
const action = Actions.renameTab("document", "Title");
model.doAction(action);
const ref = createRef<ILayoutApi>();
ref.current?.endDrag();
const props: ILayoutProps = { model, factory: () => null };
void props;
void Layout;
const history = createMemoryHistory({ initialEntries: ["/"] });
const router = createRouter({ routeTree: createRootRoute(), history });
void router;
const protectedHistory: MemoryHistory = createMemoryHistory({
  initialEntries: ["/"],
  requireNavigationApproval: true,
});
protectedHistory.block({
  blockerFn: ({ navigation }) => {
    void navigation?.finished;
    return false;
  },
  beforeCommit: ({ navigation }) => navigation?.result === undefined,
});
const receipt: HistoryNavigation = protectedHistory.push("/next");
const outcome: Promise<HistoryNavigationResult> = receipt.finished;
void outcome;
const lifetime: AbortSignal = protectedHistory.signal;
void lifetime;
void router.navigate({
  to: "/",
  onNavigationStart: (navigation) => {
    const started: HistoryNavigation = navigation;
    void started;
  },
  onNavigationResult: (result) => {
    const accepted: HistoryNavigationOutcome = result;
    void accepted;
  },
});

const nativeGlobals = model.getGlobalAttributes();
const closes: boolean | undefined = nativeGlobals.tabEnableClose;
void closes;
