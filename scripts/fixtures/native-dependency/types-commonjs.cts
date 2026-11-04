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
