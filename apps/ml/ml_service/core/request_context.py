from __future__ import annotations

from contextvars import ContextVar


request_id_var: ContextVar[str] = ContextVar("request_id", default="-")
route_path_var: ContextVar[str] = ContextVar("route_path", default="-")
job_id_var: ContextVar[str] = ContextVar("job_id", default="-")


def get_request_id() -> str:
    return request_id_var.get()


def get_route_path() -> str:
    return route_path_var.get()


def get_job_id() -> str:
    return job_id_var.get()
