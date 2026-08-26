"""本机开发端口选择：优先 8000，绑定失败时回退到未被 Windows 保留的端口。"""

import scripts.dev_backend_port as dev_port


def test_choose_backend_port_prefers_8000_when_bindable(monkeypatch) -> None:
    monkeypatch.setattr(dev_port, "port_is_bindable", lambda host, port: port == 8000)
    assert dev_port.choose_backend_port() == 8000


def test_choose_backend_port_skips_hyperv_reserved_8000(monkeypatch) -> None:
    monkeypatch.setattr(dev_port, "port_is_bindable", lambda host, port: port == 8100)
    assert dev_port.choose_backend_port() == 8100


def test_choose_backend_port_raises_when_all_candidates_fail(monkeypatch) -> None:
    monkeypatch.setattr(dev_port, "port_is_bindable", lambda host, port: False)
    try:
        dev_port.choose_backend_port()
    except RuntimeError as exc:
        assert "没有可用的本机后端端口" in str(exc)
    else:
        raise AssertionError("expected RuntimeError")
