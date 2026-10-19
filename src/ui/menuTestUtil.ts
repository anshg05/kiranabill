import { fireEvent, screen } from "@testing-library/react";

/** KB-342: the ≡ menu's items exist only while it is open - open it (if it is closed), then tap the item. */
export function chooseMenu(name: string | RegExp): void {
  const menu = screen.getByRole("button", { name: /^(Menu|मेन्यू)$/ });
  if (menu.getAttribute("aria-expanded") !== "true") fireEvent.click(menu);
  fireEvent.click(screen.getByRole("button", { name }));
}
