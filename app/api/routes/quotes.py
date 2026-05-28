"""Quote route handlers for listing, creating, and deleting pair-shared local reminder quotes."""

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.dependencies import get_current_user, get_pair_for_user
from app.core.database import get_db
from app.models import Quote, User
from app.schemas import QuoteCreate, QuoteOut

router = APIRouter(prefix="/quotes", tags=["quotes"])


@router.get("", response_model=list[QuoteOut])
def list_quotes(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> list[QuoteOut]:
    pair = get_pair_for_user(db, current_user.id)
    quotes = (
        db.execute(select(Quote).where(Quote.pair_id == pair.id).order_by(Quote.created_at.desc(), Quote.id.desc()))
        .scalars()
        .all()
    )
    return [QuoteOut.model_validate(quote) for quote in quotes]


@router.post("", response_model=QuoteOut, status_code=status.HTTP_201_CREATED)
def create_quote(
    payload: QuoteCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> QuoteOut:
    pair = get_pair_for_user(db, current_user.id)
    quote = Quote(pair_id=pair.id, author_id=current_user.id, text=payload.text)
    db.add(quote)
    db.commit()
    db.refresh(quote)
    return QuoteOut.model_validate(quote)


@router.delete("/{quote_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_quote(
    quote_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Response:
    pair = get_pair_for_user(db, current_user.id)
    quote = db.get(Quote, quote_id)
    if quote is None or quote.pair_id != pair.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Quote not found")
    db.delete(quote)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
