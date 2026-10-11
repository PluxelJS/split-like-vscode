import { expect, test } from "@playwright/test";

test("first-open focus waits for mounted content and explicit activation reveals a maximized sibling", async ({
  page,
}) => {
  await page.goto("/documents/A?view=edit&delay=0");
  await expect(page.getByLabel("Draft A")).toBeFocused();
  await page.getByRole("button", { name: "B Document B", exact: true }).click();
  await expect(page.getByLabel("Draft B")).toBeFocused();
  await page.getByRole("button", { name: "Maximize tabset", exact: true }).first().click();
  await expect(page.getByLabel("Draft B")).toBeHidden();
  await page.getByRole("button", { name: "B Document B", exact: true }).click();
  await expect(page.getByLabel("Draft B")).toBeVisible();
  await expect(page.getByLabel("Draft B")).toBeFocused();
  await expect(page.getByLabel("Draft A")).toBeHidden();
  await page.getByRole("button", { name: "Restore tabset", exact: true }).click();
  await expect(page.getByLabel("Draft A")).toBeVisible();
  await expect(page.getByLabel("Draft B")).toBeVisible();
});
