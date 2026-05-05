// 通用底部抽屉 / 居中模态 / 确认框

const root = () => document.querySelector("#dialogRoot");

export function openSheet({ title, render, onClose, footer }) {
  const sheet = document.createElement("div");
  sheet.className = "sheet";
  sheet.setAttribute("role", "dialog");
  sheet.setAttribute("aria-modal", "true");
  if (title) sheet.setAttribute("aria-label", title);

  const backdrop = document.createElement("div");
  backdrop.className = "sheet-backdrop";

  const panel = document.createElement("div");
  panel.className = "sheet-panel";

  const handle = document.createElement("div");
  handle.className = "sheet-handle";
  handle.setAttribute("aria-hidden", "true");

  const head = document.createElement("header");
  head.className = "sheet-head";
  if (title) {
    const h3 = document.createElement("h3");
    h3.textContent = title;
    head.append(h3);
  }

  const body = document.createElement("div");
  body.className = "sheet-body";

  panel.append(handle, head, body);

  if (footer) {
    const foot = document.createElement("footer");
    foot.className = "sheet-foot";
    footer.forEach((b) => foot.append(b));
    panel.append(foot);
  }

  sheet.append(backdrop, panel);
  root().append(sheet);
  document.body.classList.add("no-scroll");

  let closed = false;
  const close = (result) => {
    if (closed) return;
    closed = true;
    sheet.classList.add("is-closing");
    window.setTimeout(() => {
      sheet.remove();
      document.body.classList.remove("no-scroll");
      window.removeEventListener("keydown", onKey);
      onClose?.(result);
    }, 220);
  };

  const onKey = (e) => {
    if (e.key === "Escape") close();
  };
  window.addEventListener("keydown", onKey);
  backdrop.addEventListener("click", () => close());

  render?.({ body, close, panel });

  // 焦点管理：把焦点移到第一个可聚焦元素
  window.requestAnimationFrame(() => {
    const focusable = panel.querySelector(
      "input, textarea, select, button:not([data-no-autofocus])"
    );
    focusable?.focus({ preventScroll: true });
  });

  return { close, panel, body };
}

export function confirm({ title, message, confirmText = "确定", cancelText = "取消", danger = false }) {
  return new Promise((resolve) => {
    const wrap = document.createElement("div");
    wrap.className = "confirm";
    wrap.setAttribute("role", "alertdialog");
    wrap.setAttribute("aria-modal", "true");

    const backdrop = document.createElement("div");
    backdrop.className = "confirm-backdrop";

    const panel = document.createElement("div");
    panel.className = "confirm-panel";

    panel.innerHTML = `
      <h3></h3>
      <p></p>
      <div class="confirm-actions">
        <button type="button" class="btn btn-quiet" data-act="cancel"></button>
        <button type="button" class="btn ${danger ? "btn-danger" : "btn-primary"}" data-act="ok"></button>
      </div>
    `;
    panel.querySelector("h3").textContent = title || "请确认";
    panel.querySelector("p").textContent = message || "";
    panel.querySelector('[data-act="cancel"]').textContent = cancelText;
    panel.querySelector('[data-act="ok"]').textContent = confirmText;

    wrap.append(backdrop, panel);
    root().append(wrap);
    document.body.classList.add("no-scroll");

    const close = (result) => {
      wrap.classList.add("is-closing");
      window.setTimeout(() => {
        wrap.remove();
        document.body.classList.remove("no-scroll");
        window.removeEventListener("keydown", onKey);
        resolve(result);
      }, 200);
    };
    const onKey = (e) => {
      if (e.key === "Escape") close(false);
      if (e.key === "Enter") close(true);
    };
    window.addEventListener("keydown", onKey);

    backdrop.addEventListener("click", () => close(false));
    panel.querySelector('[data-act="cancel"]').addEventListener("click", () => close(false));
    panel.querySelector('[data-act="ok"]').addEventListener("click", () => close(true));

    window.requestAnimationFrame(() => {
      panel.querySelector('[data-act="ok"]').focus({ preventScroll: true });
    });
  });
}
