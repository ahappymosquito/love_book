"""GitHub Actions 发布工作流回归：只读默认权限、逐 job 超时、镜像冒烟先于推送、latest 仅作冒烟后的便捷指针。"""

from pathlib import Path

import yaml


PROJECT_ROOT = Path(__file__).resolve().parents[1]
WORKFLOWS = PROJECT_ROOT / ".github" / "workflows"
RELEASE_WORKFLOW = WORKFLOWS / "docker-build.yml"
MANUAL_PROMOTION_WORKFLOW = WORKFLOWS / "promote-latest.yml"
CI_WORKFLOW = WORKFLOWS / "ci.yml"
SMOKE_SCRIPT = PROJECT_ROOT / "scripts" / "ci_smoke_image.sh"


def load_workflow(path: Path) -> dict:
    return yaml.safe_load(path.read_text(encoding="utf-8"))


def job_needs(job: dict) -> list[str]:
    needs = job.get("needs", [])
    return [needs] if isinstance(needs, str) else list(needs)


def steps_text(job: dict) -> str:
    return "\n".join(str(step) for step in job.get("steps", []))


def test_every_workflow_defaults_to_read_only_and_bounds_each_job() -> None:
    for path in (RELEASE_WORKFLOW, MANUAL_PROMOTION_WORKFLOW, CI_WORKFLOW):
        workflow = load_workflow(path)
        assert workflow["permissions"] == {"contents": "read"}, path.name
        for name, job in workflow["jobs"].items():
            assert isinstance(job.get("timeout-minutes"), int), f"{path.name}:{name}"


def test_only_pushing_jobs_get_packages_write() -> None:
    release = load_workflow(RELEASE_WORKFLOW)["jobs"]
    writers = {name for name, job in release.items() if job.get("permissions", {}).get("packages") == "write"}
    assert writers == {"publish", "promote-latest"}
    assert release["release"]["permissions"] == {"contents": "write"}

    manual = load_workflow(MANUAL_PROMOTION_WORKFLOW)["jobs"]
    assert manual["promote"]["permissions"]["packages"] == "write"


def test_smoke_runs_both_images_before_any_push() -> None:
    jobs = load_workflow(RELEASE_WORKFLOW)["jobs"]
    smoke = jobs["smoke"]
    components = {entry["component"] for entry in smoke["strategy"]["matrix"]["include"]}
    assert components == {"backend", "frontend"}

    text = steps_text(smoke)
    assert "scripts/ci_smoke_image.sh" in text
    assert "'push': False" in text
    assert "'load': True" in text
    assert "needs.prep.outputs.version" in text
    assert "docker/login-action" not in text

    publish = jobs["publish"]
    assert set(job_needs(publish)) == {"prep", "smoke"}
    assert "'push': True" in steps_text(publish)
    builders = {name for name, job in jobs.items() if "docker/build-push-action" in steps_text(job)}
    assert builders == {"smoke", "publish"}


def test_smoke_script_asserts_health_version_and_frontend_home() -> None:
    script = SMOKE_SCRIPT.read_text(encoding="utf-8")

    assert "/health" in script
    assert 'payload.get("version") != expected' in script
    assert "DATABASE_URL=sqlite:" in script
    assert "org.opencontainers.image.version" in script
    assert '"${code}" == "200"' in script


def test_latest_is_a_convenience_pointer_moved_only_after_smoke_and_publish() -> None:
    workflow_text = RELEASE_WORKFLOW.read_text(encoding="utf-8")
    jobs = load_workflow(RELEASE_WORKFLOW)["jobs"]

    promote = jobs["promote-latest"]
    assert set(job_needs(promote)) == {"prep", "publish"}
    text = steps_text(promote)
    assert "imagetools create" in text
    assert "-backend:latest" in text
    assert "-frontend:latest" in text
    assert set(job_needs(jobs["release"])) == {"prep", "promote-latest"}
    assert "convenience" in workflow_text
    assert "type=raw,value=latest" not in workflow_text


def test_existing_release_can_be_promoted_without_rebuilding() -> None:
    workflow = MANUAL_PROMOTION_WORKFLOW.read_text(encoding="utf-8")

    assert "workflow_dispatch:" in workflow
    assert "gh release view" in workflow
    assert "imagetools create" in workflow
    assert "docker/build-push-action" not in workflow
