import { fireEvent, screen, within } from "@testing-library/react";

/** Opens a Radix select by its accessible name and picks the option with the given text. */
export function chooseOption(selectName: string, optionText: string): void {
  fireEvent.keyDown(screen.getByRole("combobox", { name: selectName }), { key: "Enter" });
  fireEvent.click(within(screen.getByRole("listbox")).getByText(optionText));
}
