// 简易 toast，自动消失，可堆叠

const region = () => document.querySelector("#toastRegion");

export function toast(message, type = "success", duration = 3600) {
  const node = document.createElement("div");
  node.className = `toast is-${type}`;
  node.setAttribute("role", "status");
  node.textContent = message;
  region().append(node);
  const timer = window.setTimeout(() => dismiss(node), duration);
  node.addEventListener("click", () => {
    window.clearTimeout(timer);
    dismiss(node);
  });
  return node;
}

function dismiss(node) {
  node.classList.add("is-leaving");
  window.setTimeout(() => node.remove(), 220);
}
