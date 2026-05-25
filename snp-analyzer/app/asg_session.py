"""Process-local ASG launch context bindings for integrated SNP sessions."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from app.asg_client import ASGLaunchContext, ASGLaunchSaveCredential


@dataclass(frozen=True)
class LinkedASGLaunch:
    target_type: str
    target_id: str
    context: dict[str, Any]
    launch_id: str
    save_token: str
    scope: tuple[str, ...]
    expires_at: datetime | None = None

    def allows_save(self) -> bool:
        return "snp:save_result" in self.scope

    def is_expired(self) -> bool:
        if self.expires_at is None:
            return False
        expires_at = self.expires_at
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        return expires_at <= datetime.now(timezone.utc)


_current_launch_by_user: dict[str, LinkedASGLaunch] = {}
_launch_by_session: dict[str, LinkedASGLaunch] = {}


def remember_asg_launch(
    user_id: str,
    target: ASGLaunchContext,
    launch: ASGLaunchSaveCredential | None,
    scope: list[str],
    expires_at: datetime | None,
) -> None:
    if launch is None:
        return
    _current_launch_by_user[str(user_id)] = LinkedASGLaunch(
        target_type=target.target_type,
        target_id=target.target_id,
        context=dict(target.context),
        launch_id=launch.id,
        save_token=launch.save_token,
        scope=tuple(scope),
        expires_at=expires_at,
    )


def bind_session_to_current_asg_launch(session_id: str, user_id: str) -> None:
    launch = _current_launch_by_user.get(str(user_id))
    if launch is not None:
        _launch_by_session[str(session_id)] = launch


def get_session_asg_launch(session_id: str) -> LinkedASGLaunch | None:
    return _launch_by_session.get(str(session_id))


def get_current_asg_launch(user_id: str) -> LinkedASGLaunch | None:
    return _current_launch_by_user.get(str(user_id))


def forget_session_asg_launch(session_id: str) -> None:
    _launch_by_session.pop(str(session_id), None)


def clear_asg_launch_state() -> None:
    _current_launch_by_user.clear()
    _launch_by_session.clear()
