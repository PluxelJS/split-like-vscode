import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  redirect,
  RouterProvider,
} from "@tanstack/react-router";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

afterEach(cleanup);

it("shares one route definition across independent routers, including redirects and hooks", async () => {
  const root = createRootRoute({ component: Outlet });
  const page = createRoute({
    getParentRoute: () => root,
    path: "/docs/$id",
    component: () => <p>{page.useParams().id}</p>,
    loader: ({ params }) => params.id,
  });
  const alias = createRoute({
    getParentRoute: () => root,
    path: "/alias",
    beforeLoad: () => {
      throw redirect({ to: "/docs/$id", params: { id: "B" } });
    },
  });
  const tree = root.addChildren([page, alias]);
  const a = createRouter({
    routeTree: tree,
    history: createMemoryHistory({ initialEntries: ["/docs/A"] }),
    defaultPendingMinMs: 0,
  });
  const b = createRouter({
    routeTree: tree,
    history: createMemoryHistory({ initialEntries: ["/alias"] }),
    defaultPendingMinMs: 0,
  });
  await Promise.all([a.load(), b.load()]);
  await waitFor(() => expect(b.state.location.pathname).toBe("/docs/B"));
  expect(a.state.matches.at(-1)?.loaderData).toBe("A");
  expect(b.state.matches.at(-1)?.loaderData).toBe("B");
  await act(async () => {
    render(
      <>
        <RouterProvider router={a} />
        <RouterProvider router={b} />
      </>,
    );
  });
  expect(screen.getByText("A")).toBeTruthy();
  expect(screen.getByText("B")).toBeTruthy();
});
