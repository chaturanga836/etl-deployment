"""Tests for .env loading."""

from __future__ import annotations

import os
from pathlib import Path

from dtorch_cli.envfile import load_project_env


def test_load_project_env_sets_missing_vars(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.delenv("DTORCH_PROJECT_KEY", raising=False)
    monkeypatch.delenv("DTORCH_PROJECT_SECRET", raising=False)
    (tmp_path / ".env").write_text(
        "DTORCH_PROJECT_KEY=pk_from_file\nDTORCH_PROJECT_SECRET=ps_from_file\n",
        encoding="utf-8",
    )

    loaded = load_project_env(tmp_path)

    assert loaded == tmp_path / ".env"
    assert os.environ["DTORCH_PROJECT_KEY"] == "pk_from_file"
    assert os.environ["DTORCH_PROJECT_SECRET"] == "ps_from_file"


def test_load_project_env_does_not_override_existing(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("DTORCH_PROJECT_KEY", "pk_shell")
    (tmp_path / ".env").write_text("DTORCH_PROJECT_KEY=pk_file\n", encoding="utf-8")

    load_project_env(tmp_path)

    assert os.environ["DTORCH_PROJECT_KEY"] == "pk_shell"


def test_load_project_env_missing_file(tmp_path: Path) -> None:
    assert load_project_env(tmp_path) is None
