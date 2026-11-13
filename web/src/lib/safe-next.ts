// 登录后跳转目标校验：只接受站内绝对路径，拒绝协议相对地址、反斜杠和控制字符，防止开放重定向。

export function sanitizeNext(value: string | null | undefined): string | null {
  if (!value) return null;
  if (!value.startsWith("/") || value.startsWith("//")) return null;
  if (/[\\\u0000-\u001f\u007f]/.test(value)) return null;
  return value;
}
