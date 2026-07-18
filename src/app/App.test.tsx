import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "./App";
import { identity } from "../config/identity";
import { useNavigation } from "../state/navigation";

describe("App shell", () => {
  it("opens in the Room with one primary action and no library totals", async () => {
    useNavigation.setState({ space: "room" });
    render(<App />);
    expect(await screen.findByText(identity.tagline)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Place one book here" })).toBeInTheDocument();
    // the opening view must never surface counts or statistics
    expect(screen.queryByText(/unread/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/\d+ books/i)).not.toBeInTheDocument();
  });

  it("navigates between the four spaces and back", async () => {
    useNavigation.setState({ space: "room" });
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Commonplace" }));
    expect(await screen.findByRole("main", { name: "Commonplace" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Back to the room" }));
    expect(await screen.findByText(identity.tagline)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Stacks" }));
    expect(await screen.findByRole("main", { name: "Stacks" })).toBeInTheDocument();
  });

  it("applies the ember theme to the document root on start", async () => {
    useNavigation.setState({ space: "room" });
    render(<App />);
    await screen.findByText(identity.tagline);
    expect(document.documentElement.dataset.theme).toBe("ember");
  });
});
