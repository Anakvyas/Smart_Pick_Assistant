from fastapi import APIRouter

from controllers import demo_controller

router = APIRouter()


@router.get("/api/demo")
def demo_products():
    return demo_controller.list_demo_products()
