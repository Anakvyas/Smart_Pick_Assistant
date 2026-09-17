from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.orm import Session

from app.controllers import auth_controller
from app.db.session import get_db
from app.schemas.auth import LoginRequest, SignupRequest
from app.schemas.response import SuccessResponse

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])


@router.post("/signup", response_model=SuccessResponse, status_code=status.HTTP_201_CREATED)
def signup_route(
    payload: SignupRequest,
    response: Response,
    db: Session = Depends(get_db),
) -> SuccessResponse:
    return auth_controller.signup(payload, response, db)


@router.post("/login", response_model=SuccessResponse, status_code=status.HTTP_200_OK)
def login_route(
    payload: LoginRequest,
    response: Response,
    db: Session = Depends(get_db),
) -> SuccessResponse:
    return auth_controller.login(payload, response, db)
