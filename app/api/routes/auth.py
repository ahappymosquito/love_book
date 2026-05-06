from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.dependencies import get_current_user, get_pair_for_user
from app.core.database import get_db
from app.models import User
from app.schemas import MeOut, MeUpdate, UserOut
from app.services import counterpart

router = APIRouter(prefix="/auth", tags=["auth"])


@router.get("/me", response_model=MeOut)
def read_me(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> MeOut:
    pair = get_pair_for_user(db, current_user.id)
    return MeOut(user=current_user, counterpart=counterpart(pair, current_user), pair_id=pair.id)


@router.patch("/me", response_model=UserOut)
def update_me(
    payload: MeUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> UserOut:
    data = payload.model_dump(exclude_unset=True)
    if "display_name" in data and data["display_name"] is not None:
        current_user.display_name = data["display_name"]
    if "avatar" in data and data["avatar"] is not None:
        current_user.avatar = data["avatar"]
    db.flush()
    db.refresh(current_user)
    return UserOut.model_validate(current_user)
