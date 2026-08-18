"""Regression coverage for GitHub Actions image promotion workflows."""

from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
RELEASE_WORKFLOW = PROJECT_ROOT / ".github" / "workflows" / "docker-build.yml"
MANUAL_PROMOTION_WORKFLOW = PROJECT_ROOT / ".github" / "workflows" / "promote-latest.yml"


def test_release_workflow_promotes_latest_only_after_both_images() -> None:
    workflow = RELEASE_WORKFLOW.read_text(encoding="utf-8")

    assert "promote-latest:" in workflow
    assert "needs: [prep, backend, frontend]" in workflow
    assert "imagetools create" in workflow
    assert "-backend:latest" in workflow
    assert "-frontend:latest" in workflow
    assert "needs: [prep, promote-latest]" in workflow


def test_existing_release_can_be_promoted_without_rebuilding() -> None:
    workflow = MANUAL_PROMOTION_WORKFLOW.read_text(encoding="utf-8")

    assert "workflow_dispatch:" in workflow
    assert "gh release view" in workflow
    assert "imagetools create" in workflow
    assert "docker/build-push-action" not in workflow
