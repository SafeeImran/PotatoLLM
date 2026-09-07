import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { PlaceholderPage } from "../pages/PlaceholderPage";

describe("PlaceholderPage", () => {
  it("honestly states the feature isn't built rather than showing fake data", () => {
    render(<PlaceholderPage title="Model Library" phase="Phase 5 (Model Registry)" />);
    expect(screen.getByText(/Model Library/)).toBeInTheDocument();
    expect(screen.getByText("Not built yet")).toBeInTheDocument();
    expect(screen.getByText(/Phase 5/)).toBeInTheDocument();
  });
});
