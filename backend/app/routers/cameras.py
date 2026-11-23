from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel

from ..services import protect

router = APIRouter(prefix="/cameras", tags=["cameras"])


class CameraOut(BaseModel):
    id: str
    name: str
    state: str


class CamerasResponse(BaseModel):
    configured: bool
    cameras: list[CameraOut]


@router.get(
    "",
    response_model=CamerasResponse,
    summary="List UniFi Protect cameras",
    description=(
        "Returns `{configured, cameras}` where each camera is `{id, name, state}`. "
        "When `UNIFI_PROTECT_KEY_FILE` is unset or the file is empty, `configured` is "
        "false and `cameras` is an empty list. The API key is never included."
    ),
)
def list_cameras() -> CamerasResponse:
    if not protect.configured():
        return CamerasResponse(configured=False, cameras=[])
    try:
        cameras = protect.list_cameras()
    except protect.NotConfigured:
        return CamerasResponse(configured=False, cameras=[])
    except protect.UpstreamError as exc:
        raise HTTPException(
            status_code=502,
            detail={"code": "upstream_error", "message": str(exc)},
        ) from exc
    return CamerasResponse(
        configured=True,
        cameras=[CameraOut(id=c.id, name=c.name, state=c.state) for c in cameras],
    )


@router.get(
    "/{camera_id}/snapshot",
    summary="Proxy a camera snapshot",
    description=(
        "Fetches `GET /v1/cameras/{id}/snapshot` from UniFi Protect and returns the JPEG. "
        "Responses are cached on the server for about two seconds."
    ),
)
def get_snapshot(camera_id: str) -> Response:
    if not protect.configured():
        raise HTTPException(
            status_code=503,
            detail={"code": "not_configured", "message": "not configured"},
        )
    try:
        image = protect.snapshot(camera_id)
    except protect.NotConfigured:
        raise HTTPException(
            status_code=503,
            detail={"code": "not_configured", "message": "not configured"},
        ) from None
    except protect.UpstreamError as exc:
        status = 404 if exc.status_code == 404 else 502
        raise HTTPException(
            status_code=status,
            detail={
                "code": "not_found" if status == 404 else "upstream_error",
                "message": str(exc),
            },
        ) from exc
    return Response(
        content=image.body,
        media_type=image.content_type,
        headers={"Cache-Control": "private, max-age=2"},
    )
