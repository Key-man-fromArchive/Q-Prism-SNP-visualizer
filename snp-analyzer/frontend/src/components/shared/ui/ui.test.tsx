import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Button, IconButton, Menu, StatusState } from "./index";

describe("Button", () => {
  it("renders children and fires onClick", async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>저장</Button>);
    await userEvent.click(screen.getByRole("button", { name: "저장" }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("applies variant classes and disables when loading", () => {
    render(
      <Button variant="danger" loading>
        삭제
      </Button>
    );
    const btn = screen.getByRole("button", { name: "삭제" });
    expect(btn).toBeDisabled();
    expect(btn.className).toContain("bg-danger");
  });
});

describe("IconButton", () => {
  it("exposes its aria-label as accessible name", () => {
    render(
      <IconButton aria-label="실행 취소">
        <svg />
      </IconButton>
    );
    expect(screen.getByRole("button", { name: "실행 취소" })).toBeInTheDocument();
  });
});

describe("Menu", () => {
  it("opens on click, selects an item, and closes", async () => {
    const onSelect = vi.fn();
    render(
      <Menu
        label="내보내기"
        trigger={<span>내보내기</span>}
        items={[{ key: "csv", label: "CSV", onSelect }]}
      />
    );
    const trigger = screen.getByRole("button", { name: "내보내기" });
    await userEvent.click(trigger);
    await userEvent.click(screen.getByRole("menuitem", { name: "CSV" }));
    expect(onSelect).toHaveBeenCalledOnce();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("closes on Escape", async () => {
    render(
      <Menu
        label="메뉴"
        trigger={<span>메뉴</span>}
        items={[{ key: "a", label: "A", onSelect: () => {} }]}
      />
    );
    await userEvent.click(screen.getByRole("button", { name: "메뉴" }));
    expect(screen.getByRole("menu")).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});

describe("StatusState", () => {
  it("renders an error alert with detail and retry action", async () => {
    const onClick = vi.fn();
    render(
      <StatusState
        variant="error"
        message="불러오기 실패"
        detail="네트워크 오류"
        action={{ label: "재시도", onClick }}
      />
    );
    expect(screen.getByRole("alert")).toHaveTextContent("불러오기 실패");
    await userEvent.click(screen.getByRole("button", { name: "재시도" }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("marks loading state as busy", () => {
    render(<StatusState variant="loading" message="불러오는 중" />);
    expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true");
  });
});
