import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { LocaleProvider, useT } from "./index";

function Probe() {
  const { t, setLocale } = useT();
  return (
    <div>
      <span data-testid="label">{t("nav.overview")}</span>
      <button onClick={() => setLocale("zh")}>switch</button>
    </div>
  );
}

describe("i18n", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("useT returns the en string by default (no provider)", () => {
    render(<Probe />);
    expect(screen.getByTestId("label").textContent).toBe("Overview");
  });

  it("returns the zh string within a LocaleProvider set to zh", () => {
    localStorage.setItem("roost.locale", "zh");
    render(
      <LocaleProvider>
        <Probe />
      </LocaleProvider>,
    );
    expect(screen.getByTestId("label").textContent).toBe("总览");
  });

  it("setLocale('zh') persists to localStorage", () => {
    render(
      <LocaleProvider>
        <Probe />
      </LocaleProvider>,
    );
    expect(screen.getByTestId("label").textContent).toBe("Overview");
    fireEvent.click(screen.getByText("switch"));
    expect(screen.getByTestId("label").textContent).toBe("总览");
    expect(localStorage.getItem("roost.locale")).toBe("zh");
  });
});
