from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.orm import Session

from controllers import auth_controller
from core.deps import get_current_user
from db.session import get_db
from models.user import User
from schemas.auth import LoginRequest, SignupRequest
from schemas.response import SuccessResponse

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


@router.get("/me", response_model=SuccessResponse, status_code=status.HTTP_200_OK)
def me_route(user: User = Depends(get_current_user)) -> SuccessResponse:
    return auth_controller.me(user)


@router.post("/logout", response_model=SuccessResponse, status_code=status.HTTP_200_OK)
def logout_route(response: Response) -> SuccessResponse:
    return auth_controller.logout(response)
