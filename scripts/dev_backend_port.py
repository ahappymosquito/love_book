"""为本机开发后端挑选可绑定的 loopback 端口，避开 Windows Hyper-V 保留段。"""

from __future__ import annotations

import socket
import sys

PREFERRED_PORT = 8000
FALLBACK_PORTS = (8100, 18000, 28000)


def port_is_bindable(host: str, port: int) -> bool:
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        sock.bind((host, port))
    except OSError:
        return False
    finally:
        sock.close()
    return True


def choose_backend_port(host: str = "127.0.0.1", preferred: int = PREFERRED_PORT) -> int:
    candidates = (preferred, *tuple(port for port in FALLBACK_PORTS if port != preferred))
    for port in candidates:
        if port_is_bindable(host, port):
            return port
    raise RuntimeError("没有可用的本机后端端口")


def main() -> int:
    try:
        port = choose_backend_port()
    except RuntimeError as exc:
        print(str(exc), file=sys.stderr)
        return 1
    if port != PREFERRED_PORT:
        print(
            f"本机无法绑定 {PREFERRED_PORT}（常见于 Windows Hyper-V 保留端口），改用 {port}。",
            file=sys.stderr,
        )
    print(port)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
