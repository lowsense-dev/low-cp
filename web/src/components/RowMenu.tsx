import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { MoreHorizontal } from "lucide-react";
import { cn } from "../lib/util";
import { IconButton } from "./ui";

export type MenuItem = { label: string; icon: ReactNode; onClick: () => void; danger?: boolean; hidden?: boolean };

const MENU_WIDTH = 208;

/** Row action menu rendered in a portal so table scroll containers cannot clip it. */
export function RowMenu({ items }: { items: MenuItem[] }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; up: boolean } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const visible = items.filter((item) => !item.hidden);

  useLayoutEffect(() => {
    if (!open || !button.current) return;
    const rect = button.current.getBoundingClientRect();
    const height = visible.length * 34 + 8;
    // Open upwards when the menu would run past the bottom of the viewport.
    const up = rect.bottom + height + 8 > window.innerHeight && rect.top > height;
    setPos({ top: up ? rect.top - height - 4 : rect.bottom + 4, left: Math.max(8, rect.right - MENU_WIDTH), up });
  }, [open, visible.length]);

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e.type === "mousedown" && (menu.current?.contains(e.target as Node) || button.current?.contains(e.target as Node))) return;
      setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  return (
    <>
      <IconButton ref={button} label="Menu" onClick={() => setOpen(!open)} aria-expanded={open} aria-haspopup="menu">
        <MoreHorizontal className="size-4" />
      </IconButton>
      {open &&
        pos &&
        createPortal(
          <div ref={menu} role="menu" style={{ top: pos.top, left: pos.left, width: MENU_WIDTH }} className="animate-pop-in fixed z-50 rounded-xl border border-line bg-surface p-1 shadow-panel">
            {visible.map((item) => (
              <button
                key={item.label}
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  item.onClick();
                }}
                className={cn("flex h-[34px] w-full items-center gap-2 rounded-lg px-2.5 text-left text-sm [&_svg]:size-4", item.danger ? "text-err hover:bg-err-soft" : "hover:bg-surface-2")}
              >
                {item.icon}
                {item.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
