from http import HTTPStatus

from pydantic import BaseModel

from observability import ErrorCode


class ErrorField(BaseModel):
    field: str
    message: str
    type: str


class ErrorDetail(BaseModel):
    code: ErrorCode
    message: str
    errors: list[ErrorField] | None = None


class ErrorResponse(BaseModel):
    detail: ErrorDetail


def error_responses(*statuses: int) -> dict[int, dict]:
    """Document AppError and request-validation responses in OpenAPI."""
    return {status: {"model": ErrorResponse, "description": HTTPStatus(status).phrase} for status in statuses}
