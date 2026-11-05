import history = require("@tanstack/history");
import reactRouter = require("@tanstack/react-router");

const memory: history.MemoryHistory = history.createMemoryHistory({
  initialEntries: ["/"],
  requireNavigationApproval: true,
});
memory.block({
  blockerFn: ({ navigation }) => {
    void navigation?.finished;
    return false;
  },
  beforeCommit: ({ navigation }) => navigation?.result === undefined,
});
const navigation: history.HistoryNavigation = memory.push("/next");
const lifetime: AbortSignal = memory.signal;
void navigation;
void lifetime;
const router = reactRouter.createRouter({
  routeTree: reactRouter.createRootRoute(),
  history: memory,
});
void router.navigate({
  to: "/",
  onNavigationStart: (started) => {
    const receipt: history.HistoryNavigation = started;
    void receipt;
  },
  onNavigationResult: (result) => {
    const outcome: history.HistoryNavigationOutcome = result;
    void outcome;
  },
});

// The Router/history protocol has an explicit completion owner in both module formats.
const claim: (navigation: history.HistoryNavigation, owner: object) => void =
  memory.claimNavigation;
void claim;
