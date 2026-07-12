"""Quote routes for pair-shared edits, read-only defaults, and fast randomized batches for Timeline rotation."""

import random

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.dependencies import get_current_user, get_pair_for_user
from app.core.database import get_db
from app.models import DefaultQuote, Quote, User
from app.schemas import DefaultQuoteOut, QuoteCreate, QuoteOut, QuoteSampleOut
from app.services import ensure_default_quotes

router = APIRouter(prefix="/quotes", tags=["quotes"])


@router.get("/sample", response_model=QuoteSampleOut)
def sample_quotes(
    limit: int = Query(default=5, ge=1, le=10),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> QuoteSampleOut:
    pair = get_pair_for_user(db, current_user.id)
    ensure_default_quotes(db)
    pair_quotes = db.execute(select(Quote.text).where(Quote.pair_id == pair.id)).scalars().all()
    default_quotes = db.execute(select(DefaultQuote.text)).scalars().all()
    quote_pool = list(dict.fromkeys([*pair_quotes, *default_quotes]))
    sample_size = min(limit, len(quote_pool))
    return QuoteSampleOut(items=random.sample(quote_pool, sample_size) if sample_size else [])


@router.get("", response_model=list[QuoteOut])
def list_quotes(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> list[QuoteOut]:
    pair = get_pair_for_user(db, current_user.id)
    quotes = (
        db.execute(select(Quote).where(Quote.pair_id == pair.id).order_by(Quote.created_at.desc(), Quote.id.desc()))
        .scalars()
        .all()
    )
    return [QuoteOut.model_validate(quote) for quote in quotes]


@router.get("/defaults", response_model=list[DefaultQuoteOut])
def list_default_quotes(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[DefaultQuoteOut]:
    ensure_default_quotes(db)
    quotes = db.execute(select(DefaultQuote).order_by(DefaultQuote.id)).scalars().all()
    return [DefaultQuoteOut.model_validate(quote) for quote in quotes]


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
