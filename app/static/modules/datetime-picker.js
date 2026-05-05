// 移动端友好的滚轮日期+时间选择器
// 设计：5 列（年/月/日/时/分），原生 scroll-snap 实现吸附；点击高亮项也可逐项滚动；
// 中央高亮带固定不动；spacer 让中心对齐。
// 桌面端仍用同一组件，但模态居中。

import { openSheet } from "./dialog.js";

const ITEM_H = 44;
const VISIBLE = 5;
const SPACER = ITEM_H * Math.floor(VISIBLE / 2);

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}
function pad2(n) {
  return String(n).padStart(2, "0");
}
function daysIn(year, month) {
  return new Date(year, month, 0).getDate();
}

class Wheel {
  constructor(host, items, initialIndex, onChange) {
    this.host = host;
    this.items = items;
    this.onChange = onChange;
    this.index = clamp(initialIndex ?? 0, 0, items.length - 1);

    host.classList.add("wheel-col");
    host.innerHTML = "";

    const top = document.createElement("div");
    top.className = "wheel-spacer";
    host.append(top);

    items.forEach((label, i) => {
      const el = document.createElement("div");
      el.className = "wheel-item";
      el.textContent = label;
      el.dataset.idx = String(i);
      host.append(el);
    });

    const bot = document.createElement("div");
    bot.className = "wheel-spacer";
    host.append(bot);

    this._scrollTimer = null;
    this._userScrolling = false;

    host.addEventListener("scroll", () => this._onScroll(), { passive: true });
    host.addEventListener("click", (e) => {
      const item = e.target.closest(".wheel-item");
      if (!item) return;
      const idx = Number(item.dataset.idx);
      this.setIndex(idx, true);
    });

    this._setVisualIndex(this.index);
    // 初次定位（不动画）
    requestAnimationFrame(() => {
      host.scrollTop = this.index * ITEM_H;
      this._setVisualIndex(this.index);
    });
  }

  setItems(items, keepIndex) {
    this.items = items;
    while (this.host.children.length > 2) {
      this.host.removeChild(this.host.children[1]);
    }
    items.forEach((label, i) => {
      const el = document.createElement("div");
      el.className = "wheel-item";
      el.textContent = label;
      el.dataset.idx = String(i);
      this.host.insertBefore(el, this.host.lastElementChild);
    });
    this.setIndex(clamp(keepIndex ?? this.index, 0, items.length - 1), false);
  }

  setIndex(i, smooth = true) {
    this.index = clamp(i, 0, this.items.length - 1);
    this._setVisualIndex(this.index);
    this.host.scrollTo({
      top: this.index * ITEM_H,
      behavior: smooth ? "smooth" : "auto",
    });
  }

  getIndex() {
    return this.index;
  }

  _onScroll() {
    if (this._scrollTimer) clearTimeout(this._scrollTimer);
    const i = clamp(Math.round(this.host.scrollTop / ITEM_H), 0, this.items.length - 1);
    this._setVisualIndex(i);
    this._scrollTimer = setTimeout(() => {
      const final = clamp(Math.round(this.host.scrollTop / ITEM_H), 0, this.items.length - 1);
      const targetTop = final * ITEM_H;
      if (Math.abs(this.host.scrollTop - targetTop) > 0.5) {
        this.host.scrollTo({ top: targetTop, behavior: "smooth" });
      }
      const changed = final !== this.index;
      this.index = final;
      this._setVisualIndex(final);
      if (changed) this.onChange?.(final);
    }, 120);
  }

  _setVisualIndex(i) {
    const items = this.host.querySelectorAll(".wheel-item");
    items.forEach((el, k) => el.classList.toggle("is-active", k === i));
  }
}

export function openDateTimePicker({ value, onConfirm, title = "选择发生时间" } = {}) {
  const init = value instanceof Date ? value : value ? new Date(value) : new Date();
  const now = new Date();

  const yearStart = Math.min(init.getFullYear(), now.getFullYear()) - 10;
  const yearEnd = Math.max(init.getFullYear(), now.getFullYear()) + 1;
  const years = [];
  for (let y = yearStart; y <= yearEnd; y++) years.push(`${y} 年`);
  const months = Array.from({ length: 12 }, (_, i) => `${i + 1} 月`);
  const hours = Array.from({ length: 24 }, (_, i) => `${pad2(i)} 时`);
  const minutes = Array.from({ length: 60 }, (_, i) => `${pad2(i)} 分`);

  const sel = {
    year: clamp(init.getFullYear(), yearStart, yearEnd),
    month: init.getMonth() + 1,
    day: init.getDate(),
    hour: init.getHours(),
    minute: init.getMinutes(),
  };

  const makeDays = () =>
    Array.from({ length: daysIn(sel.year, sel.month) }, (_, i) => `${i + 1} 日`);

  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "btn btn-quiet";
  cancelBtn.textContent = "取消";
  cancelBtn.dataset.noAutofocus = "true";

  const okBtn = document.createElement("button");
  okBtn.type = "button";
  okBtn.className = "btn btn-primary";
  okBtn.textContent = "确定";

  const sheet = openSheet({
    title,
    footer: [cancelBtn, okBtn],
    render: ({ body, close }) => {
      body.innerHTML = `
        <div class="dt-quick">
          <button type="button" class="chip" data-act="now">现在</button>
          <button type="button" class="chip" data-act="today-evening">今天晚上</button>
          <button type="button" class="chip chip-quiet" data-act="clear">清空</button>
        </div>
        <div class="wheel">
          <div class="wheel-band" aria-hidden="true"></div>
          <div data-w="year"></div>
          <div data-w="month"></div>
          <div data-w="day"></div>
          <div data-w="hour"></div>
          <div data-w="minute"></div>
        </div>
      `;

      const wheels = {
        year: new Wheel(body.querySelector('[data-w="year"]'), years, sel.year - yearStart, (i) => {
          sel.year = yearStart + i;
          syncDays();
        }),
        month: new Wheel(body.querySelector('[data-w="month"]'), months, sel.month - 1, (i) => {
          sel.month = i + 1;
          syncDays();
        }),
        day: new Wheel(body.querySelector('[data-w="day"]'), makeDays(), sel.day - 1, (i) => {
          sel.day = i + 1;
        }),
        hour: new Wheel(body.querySelector('[data-w="hour"]'), hours, sel.hour, (i) => {
          sel.hour = i;
        }),
        minute: new Wheel(body.querySelector('[data-w="minute"]'), minutes, sel.minute, (i) => {
          sel.minute = i;
        }),
      };

      function syncDays() {
        const max = daysIn(sel.year, sel.month);
        if (sel.day > max) sel.day = max;
        wheels.day.setItems(makeDays(), sel.day - 1);
      }

      function applyDate(d) {
        sel.year = clamp(d.getFullYear(), yearStart, yearEnd);
        sel.month = d.getMonth() + 1;
        sel.day = d.getDate();
        sel.hour = d.getHours();
        sel.minute = d.getMinutes();
        wheels.year.setIndex(sel.year - yearStart);
        wheels.month.setIndex(sel.month - 1);
        syncDays();
        wheels.day.setIndex(sel.day - 1);
        wheels.hour.setIndex(sel.hour);
        wheels.minute.setIndex(sel.minute);
      }

      body.addEventListener("click", (e) => {
        const t = e.target.closest("[data-act]");
        if (!t) return;
        const act = t.dataset.act;
        if (act === "now") applyDate(new Date());
        else if (act === "today-evening") {
          const d = new Date();
          d.setHours(20, 0, 0, 0);
          applyDate(d);
        } else if (act === "clear") {
          onConfirm?.(null);
          close();
        }
      });

      cancelBtn.addEventListener("click", () => close());
      okBtn.addEventListener("click", () => {
        const d = new Date(sel.year, sel.month - 1, sel.day, sel.hour, sel.minute, 0, 0);
        onConfirm?.(d);
        close();
      });
    },
  });

  return sheet;
}
