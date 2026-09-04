class ServiceError(Exception):
    status_code = 500
    code = "internal_error"

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


class InvalidRequest(ServiceError):
    status_code = 400
    code = "invalid_request"


class InvalidImage(ServiceError):
    status_code = 422
    code = "invalid_image"


class PayloadTooLarge(ServiceError):
    status_code = 413
    code = "payload_too_large"


class UnsafeImageUrl(ServiceError):
    status_code = 400
    code = "unsafe_image_url"


class BackendUnavailable(ServiceError):
    status_code = 503
    code = "backend_unavailable"


class CapacityExceeded(ServiceError):
    status_code = 429
    code = "capacity_exceeded"


class TaskNotFound(ServiceError):
    status_code = 404
    code = "task_not_found"


class TaskConflict(ServiceError):
    status_code = 409
    code = "task_conflict"
