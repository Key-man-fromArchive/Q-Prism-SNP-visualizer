import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Button, IconButton, Menu, StatusState, Modal, ConfirmDialog } from "./index";

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

describe("Modal", () => {
  it("renders when open with dialog role + labelled title, closes on Escape", async () => {
    const onClose = vi.fn();
    render(<Modal open title="제목" description="설명" onClose={onClose}><p>본문</p></Modal>);
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAccessibleName("제목");
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("does not render when closed", () => {
    render(<Modal open={false} title="x" onClose={() => {}} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("ConfirmDialog", () => {
  it("uses alertdialog for danger and fires confirm/cancel", async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        open
        danger
        title="삭제"
        message="되돌릴 수 없습니다"
        confirmLabel="삭제"
        cancelLabel="취소"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    );
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "취소" }));
    expect(onCancel).toHaveBeenCalledOnce();
    await userEvent.click(screen.getByRole("button", { name: "삭제" }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });
});
