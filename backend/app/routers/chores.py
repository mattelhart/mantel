"""Chores the household does, and rewards those stars can buy.

A chore is stored once. Each day it falls on is its own completion, so Monday
does not check off Tuesday. Assignees are family members — a child has a name
and a color, not a login.

Stars are a ledger (`star_entries`). The balance is the sum. A `request_id`
from the screen makes a retry of the same tap return the original result
instead of writing another row.
"""

import re
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from ..db import get_db
from ..models import (
    Chore,
    ChoreAssignee,
    ChoreCompletion,
    PointRequest,
    Reward,
    RewardRedemption,
    StarEntry,
    User,
    utcnow,
)
from ..services.chores import household_today, occurs_on
from ..services.providers.registry import home_timezone

router = APIRouter(prefix="/chores", tags=["chores"])
rewards_router = APIRouter(prefix="/rewards", tags=["rewards"])
redemptions_router = APIRouter(prefix="/redemptions", tags=["rewards"])

SCHEDULES = ("daily", "weekly", "once")


class ChoreIn(BaseModel):
    title: str = Field(min_length=1, max_length=200, examples=["Make bed"])
    notes: str | None = None
    points: int = Field(default=1, ge=0, le=100, description="Stars earned for one occurrence.")
    schedule: str = Field(default="daily", examples=["weekly"])
    weekdays: list[int] | None = Field(
        default=None,
        description="For a weekly chore: 0 = Sunday … 6 = Saturday. Ignored otherwise.",
    )
    due_on: date | None = Field(default=None, description="For a one-off chore, the day it is due.")
    requires_approval: bool = False
    icon: str | None = Field(default=None, max_length=16)
    assignee_ids: list[int] = Field(
        min_length=1, description="Who has to do it. Each person checks their own."
    )


class ChoreUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    notes: str | None = None
    points: int | None = Field(default=None, ge=0, le=100)
    schedule: str | None = None
    weekdays: list[int] | None = None
    due_on: date | None = None
    requires_approval: bool | None = None
    icon: str | None = Field(default=None, max_length=16)
    assignee_ids: list[int] | None = None


class ChoreOut(BaseModel):
    id: int
    title: str
    notes: str | None
    points: int
    schedule: str
    weekdays: list[int]
    due_on: date | None
    requires_approval: bool
    icon: str | None
    assignee_ids: list[int]


class CompletionOut(BaseModel):
    id: int
    chore_id: int
    user_id: int
    on: date
    status: str = Field(description="'pending' (waiting for approval) or 'done'.")
    points_awarded: int


class CompleteIn(BaseModel):
    user_id: int
    on: date | None = Field(
        default=None, description="Which day. Defaults to today in the home timezone."
    )
    done: bool = True
    request_id: str | None = Field(
        default=None,
        description=(
            "Chosen by the screen for this tap. Send the same value on a retry. "
            "A repeat does not award or remove stars again."
        ),
    )


class CompleteResult(BaseModel):
    completion: CompletionOut | None


class BoardChore(BaseModel):
    chore_id: int
    title: str
    notes: str | None
    icon: str | None
    points: int
    requires_approval: bool
    schedule: str
    completion: CompletionOut | None


class PersonBoard(BaseModel):
    user_id: int
    name: str
    color: str
    avatar_emoji: str | None
    stars: int
    chores: list[BoardChore]


class RewardIn(BaseModel):
    title: str = Field(min_length=1, max_length=200, examples=["Pick the movie"])
    description: str | None = None
    points_cost: int = Field(ge=1, le=10000, examples=[10])
    icon: str | None = Field(default=None, max_length=16)


class RewardUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = None
    points_cost: int | None = Field(default=None, ge=1, le=10000)
    icon: str | None = Field(default=None, max_length=16)


class RewardOut(BaseModel):
    id: int
    title: str
    description: str | None
    points_cost: int
    icon: str | None


class RedeemIn(BaseModel):
    user_id: int
    request_id: str | None = Field(
        default=None,
        description="The same value spends the stars at most once.",
    )


class RedemptionOut(BaseModel):
    id: int
    reward_id: int
    reward_title: str
    user_id: int
    user_name: str
    color: str
    points_spent: int
    status: str = Field(description="'pending', 'fulfilled', or 'denied'.")


class PendingApproval(BaseModel):
    completion_id: int
    chore_id: int
    title: str
    user_id: int
    user_name: str
    color: str
    points: int
    on: date


class BoardOut(BaseModel):
    on: date
    people: list[PersonBoard]
    rewards: list[RewardOut]
    pending_redemptions: list[RedemptionOut]
    pending_approvals: list[PendingApproval] = Field(
        description="Checks still waiting, on any day — not only the day this board is for."
    )


def _encode_weekdays(days: list[int] | None) -> str | None:
    if not days:
        return None
    bad = [d for d in days if not isinstance(d, int) or d < 0 or d > 6]
    if bad:
        raise HTTPException(400, "weekdays must be 0 (Sunday) through 6 (Saturday)")
    return ",".join(str(d) for d in sorted(set(days)))


def _decode_weekdays(raw: str | None) -> list[int]:
    if not raw:
        return []
    return [int(part) for part in raw.split(",") if part]


def _apply_schedule(schedule: str, weekdays: list[int] | None, due_on: date | None):
    if schedule not in SCHEDULES:
        raise HTTPException(400, "schedule must be daily, weekly, or once")
    if schedule == "weekly":
        stored = _encode_weekdays(weekdays)
        if not stored:
            raise HTTPException(400, "A weekly chore needs at least one weekday")
        return stored, None
    if schedule == "once":
        if due_on is None:
            raise HTTPException(400, "A one-off chore needs a due_on date")
        return None, due_on
    return None, None


def _guess_chore_icon(title: str) -> str:
    n = title.lower()
    if "bed" in n:
        return "🛏️"
    if "dish" in n or "kitchen" in n:
        return "🍽️"
    if any(word in n for word in ("trash", "garbage", "rubbish", "recycl")):
        return "🗑️"
    if any(word in n for word in ("dog", "pet", "cat", "walk", "feed")):
        return "🐕"
    if any(word in n for word in ("homework", "school", "read")):
        return "📚"
    if "laundry" in n or "clothes" in n:
        return "👕"
    if any(word in n for word in ("room", "tidy", "clean", "vacuum")):
        return "🧹"
    return "⭐"


def _guess_reward_icon(title: str) -> str:
    n = title.lower()
    if "movie" in n or "film" in n:
        return "🎬"
    if "ice" in n or "dessert" in n or "treat" in n:
        return "🍦"
    if "game" in n:
        return "🎮"
    if any(word in n for word in ("park", "trip", "out")):
        return "🌳"
    if "late" in n or "stay up" in n:
        return "🌙"
    return "🎁"


def _users(db: Session, ids: list[int]) -> list[int]:
    unique: list[int] = []
    for uid in ids:
        if uid not in unique:
            unique.append(uid)
    if not unique:
        raise HTTPException(400, "Assign the chore to at least one person")
    for uid in unique:
        if db.get(User, uid) is None:
            raise HTTPException(404, "User not found")
    return unique


def _set_assignees(db: Session, chore: Chore, ids: list[int]) -> None:
    unique = _users(db, ids)
    chore.assignees.clear()
    db.flush()
    for uid in unique:
        chore.assignees.append(ChoreAssignee(user_id=uid))


def _chore_out(chore: Chore) -> ChoreOut:
    return ChoreOut(
        id=chore.id,
        title=chore.title,
        notes=chore.notes,
        points=chore.points,
        schedule=chore.schedule,
        weekdays=_decode_weekdays(chore.weekdays),
        due_on=chore.due_on,
        requires_approval=chore.requires_approval,
        icon=chore.icon,
        assignee_ids=[row.user_id for row in chore.assignees],
    )


def _load_chore(db: Session, chore_id: int) -> Chore:
    chore = db.scalar(
        select(Chore).where(Chore.id == chore_id).options(selectinload(Chore.assignees))
    )
    if chore is None or chore.archived:
        raise HTTPException(404, "Chore not found")
    return chore


def _today(db: Session) -> date:
    return household_today(home_timezone(db))


def _parse_on(db: Session, raw: str | None) -> date:
    if not raw:
        return _today(db)
    try:
        return date.fromisoformat(raw)
    except ValueError:
        raise HTTPException(400, "`on` must be YYYY-MM-DD") from None


def _completion_out(row: ChoreCompletion) -> CompletionOut:
    return CompletionOut(
        id=row.id,
        chore_id=row.chore_id,
        user_id=row.user_id,
        on=row.on_date,
        status=row.status,
        points_awarded=row.points_awarded,
    )


def _award(
    db: Session,
    user_id: int,
    delta: int,
    reason: str,
    note: str,
    *,
    completion_id: int | None = None,
    redemption_id: int | None = None,
) -> None:
    if delta == 0:
        return
    db.add(
        StarEntry(
            user_id=user_id,
            delta=delta,
            reason=reason,
            note=note[:200],
            chore_completion_id=completion_id,
            redemption_id=redemption_id,
        )
    )


def _balances(db: Session) -> dict[int, int]:
    rows = db.execute(
        select(StarEntry.user_id, func.coalesce(func.sum(StarEntry.delta), 0)).group_by(
            StarEntry.user_id
        )
    ).all()
    return {int(uid): int(total) for uid, total in rows}


def _reward_out(row: Reward) -> RewardOut:
    return RewardOut(
        id=row.id,
        title=row.title,
        description=row.description,
        points_cost=row.points_cost,
        icon=row.icon,
    )


def _redemption_out(row: RewardRedemption) -> RedemptionOut:
    return RedemptionOut(
        id=row.id,
        reward_id=row.reward_id,
        reward_title=row.reward.title if row.reward else "Reward",
        user_id=row.user_id,
        user_name=row.user.name if row.user else "",
        color=row.user.color if row.user else "#64748b",
        points_spent=row.points_spent,
        status=row.status,
    )


def _load_redemption(db: Session, redemption_id: int) -> RewardRedemption:
    row = db.scalar(
        select(RewardRedemption)
        .where(RewardRedemption.id == redemption_id)
        .options(selectinload(RewardRedemption.reward), selectinload(RewardRedemption.user))
    )
    if row is None:
        raise HTTPException(404, "Redemption not found")
    return row


# -------------------------------- chores -------------------------------------


@router.get(
    "",
    response_model=list[ChoreOut],
    summary="List chore definitions",
    description=(
        "The chores themselves, not today's checklist. Use `GET /chores/board` for who "
        "has done what on a given day."
    ),
)
def list_chores(db: Session = Depends(get_db)) -> list[ChoreOut]:
    rows = db.scalars(
        select(Chore)
        .where(Chore.archived.is_(False))
        .order_by(Chore.id)
        .options(selectinload(Chore.assignees))
    )
    return [_chore_out(row) for row in rows]


@router.post("", response_model=ChoreOut, status_code=201, summary="Create a chore")
def create_chore(payload: ChoreIn, db: Session = Depends(get_db)) -> ChoreOut:
    weekdays, due_on = _apply_schedule(payload.schedule, payload.weekdays, payload.due_on)
    chore = Chore(
        title=payload.title.strip(),
        notes=payload.notes,
        points=payload.points,
        schedule=payload.schedule,
        weekdays=weekdays,
        due_on=due_on,
        requires_approval=payload.requires_approval,
        icon=(payload.icon or "").strip() or _guess_chore_icon(payload.title),
    )
    db.add(chore)
    db.flush()
    _set_assignees(db, chore, payload.assignee_ids)
    db.commit()
    return _chore_out(_load_chore(db, chore.id))


@router.get(
    "/board",
    response_model=BoardOut,
    summary="One day's chores, star balances, and rewards",
    description=(
        "What the wall and a TV show. `on` is a calendar day (`YYYY-MM-DD`); omit it for "
        "today in the household timezone. Every family member is included, so a person "
        "with no chores still shows their stars. Pending approvals and reward requests "
        "are included from every day, not only `on`."
    ),
)
def board(
    on: str | None = Query(default=None, description="YYYY-MM-DD. Defaults to today at home."),
    db: Session = Depends(get_db),
) -> BoardOut:
    day = _parse_on(db, on)
    return _board(db, day)


@router.post(
    "/{chore_id}/complete",
    response_model=CompleteResult,
    summary="Check or uncheck one person's occurrence",
    description=(
        "Each assignee has their own check for that day — Monday does not complete "
        "Tuesday. `done: true` marks it done, or `pending` when the chore requires "
        "approval. Stars wait for `POST /chores/completions/{id}/approve`. "
        "`done: false` removes the check and, if stars were awarded, writes that "
        "number back. Send `request_id` to make a retry of this tap a no-op."
    ),
)
def complete_chore(
    chore_id: int, payload: CompleteIn, db: Session = Depends(get_db)
) -> CompleteResult:
    chore = _load_chore(db, chore_id)
    if db.get(User, payload.user_id) is None:
        raise HTTPException(404, "User not found")
    if payload.user_id not in {row.user_id for row in chore.assignees}:
        raise HTTPException(400, "That person is not assigned to this chore")
    day = payload.on or _today(db)
    if not occurs_on(chore.schedule, chore.weekdays, chore.due_on, day):
        raise HTTPException(400, "This chore is not scheduled that day")

    request_id = _request_id(payload.request_id)
    if request_id is not None:
        prior = _prior_request(db, request_id)
        if prior is not None:
            if prior.action not in ("complete", "undo"):
                raise HTTPException(409, "request_id was already used")
            current = _occurrence(db, chore.id, payload.user_id, day)
            return CompleteResult(completion=_completion_out_or_none(current))

    existing = _occurrence(db, chore.id, payload.user_id, day)
    if payload.done:
        if existing is not None and existing.status in ("pending", "done"):
            if not _claim(db, request_id, "complete", existing.id, None):
                current = _occurrence(db, chore.id, payload.user_id, day)
                return CompleteResult(completion=_completion_out_or_none(current))
            db.commit()
            return CompleteResult(completion=_completion_out(existing))
        if existing is not None:
            db.delete(existing)
            db.flush()
        status = "pending" if chore.requires_approval else "done"
        awarded = 0 if chore.requires_approval else chore.points
        row = ChoreCompletion(
            chore_id=chore.id,
            user_id=payload.user_id,
            on_date=day,
            status=status,
            points_awarded=awarded,
            completed_at=utcnow(),
            reviewed_at=None if chore.requires_approval else utcnow(),
        )
        db.add(row)
        try:
            db.flush()
        except IntegrityError:
            db.rollback()
            again = _occurrence(db, chore.id, payload.user_id, day)
            if again is None:
                raise
            return CompleteResult(completion=_completion_out(again))
        if awarded:
            _award(db, payload.user_id, awarded, "chore", chore.title, completion_id=row.id)
        if not _claim(db, request_id, "complete", row.id, None):
            return CompleteResult(
                completion=_completion_out_or_none(_occurrence(db, chore.id, payload.user_id, day))
            )
        db.commit()
        db.refresh(row)
        return CompleteResult(completion=_completion_out(row))

    if existing is None:
        if not _claim(db, request_id, "undo", None, None):
            return CompleteResult(
                completion=_completion_out_or_none(_occurrence(db, chore.id, payload.user_id, day))
            )
        db.commit()
        return CompleteResult(completion=None)
    if existing.points_awarded:
        _award(
            db,
            existing.user_id,
            -existing.points_awarded,
            "reversal",
            f"{chore.title} unchecked",
            completion_id=existing.id,
        )
    db.delete(existing)
    if not _claim(db, request_id, "undo", None, None):
        return CompleteResult(
            completion=_completion_out_or_none(_occurrence(db, chore.id, payload.user_id, day))
        )
    db.commit()
    return CompleteResult(completion=None)


@router.post(
    "/completions/{completion_id}/approve",
    response_model=CompletionOut,
    summary="Approve a check and award its stars",
)
def approve_completion(completion_id: int, db: Session = Depends(get_db)) -> CompletionOut:
    row = db.scalar(
        select(ChoreCompletion)
        .where(ChoreCompletion.id == completion_id)
        .options(selectinload(ChoreCompletion.chore))
    )
    if row is None or row.chore is None:
        raise HTTPException(404, "Completion not found")
    # A retry of an approval that already landed must not grant the stars again.
    if row.status == "done":
        return _completion_out(row)
    if row.status != "pending":
        raise HTTPException(400, "That chore is not waiting for approval")
    row.status = "done"
    row.points_awarded = row.chore.points
    row.reviewed_at = utcnow()
    if row.points_awarded:
        _award(
            db,
            row.user_id,
            row.points_awarded,
            "chore",
            row.chore.title,
            completion_id=row.id,
        )
    db.commit()
    db.refresh(row)
    return _completion_out(row)


@router.post(
    "/completions/{completion_id}/reject",
    status_code=204,
    summary="Send a pending check back",
    description="No stars were awarded yet, so this only clears the check.",
)
def reject_completion(completion_id: int, db: Session = Depends(get_db)) -> None:
    row = _pending(db, completion_id)
    db.delete(row)
    db.commit()


@router.patch("/{chore_id}", response_model=ChoreOut, summary="Edit a chore")
def update_chore(chore_id: int, payload: ChoreUpdate, db: Session = Depends(get_db)) -> ChoreOut:
    chore = _load_chore(db, chore_id)
    changes = payload.model_dump(exclude_unset=True)
    schedule = changes.get("schedule", chore.schedule)
    weekdays = changes["weekdays"] if "weekdays" in changes else _decode_weekdays(chore.weekdays)
    due_on = changes["due_on"] if "due_on" in changes else chore.due_on
    stored_days, stored_due = _apply_schedule(schedule, weekdays, due_on)
    if "title" in changes and changes["title"] is not None:
        chore.title = changes["title"].strip()
    if "notes" in changes:
        chore.notes = changes["notes"]
    if "points" in changes and changes["points"] is not None:
        chore.points = changes["points"]
    if "requires_approval" in changes and changes["requires_approval"] is not None:
        chore.requires_approval = changes["requires_approval"]
    if "icon" in changes:
        chore.icon = (changes["icon"] or "").strip() or _guess_chore_icon(chore.title)
    chore.schedule = schedule
    chore.weekdays = stored_days
    chore.due_on = stored_due
    if "assignee_ids" in changes and changes["assignee_ids"] is not None:
        _set_assignees(db, chore, changes["assignee_ids"])
    db.commit()
    return _chore_out(_load_chore(db, chore.id))


@router.delete(
    "/{chore_id}",
    status_code=204,
    summary="Retire a chore",
    description=(
        "The chore leaves the board. Stars already earned stay — uncheck it first if "
        "those should come back. A check that was still waiting for approval is dropped."
    ),
)
def delete_chore(chore_id: int, db: Session = Depends(get_db)) -> None:
    chore = _load_chore(db, chore_id)
    pending = db.scalars(
        select(ChoreCompletion).where(
            ChoreCompletion.chore_id == chore.id, ChoreCompletion.status == "pending"
        )
    )
    for row in pending:
        db.delete(row)
    chore.archived = True
    db.commit()


_REQUEST_ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


def _request_id(raw: str | None) -> str | None:
    if raw is None:
        return None
    value = raw.strip()
    if not value:
        return None
    if _REQUEST_ID.fullmatch(value) is None:
        raise HTTPException(400, "request_id must be 1–64 letters, numbers, _ or -")
    return value


def _prior_request(db: Session, request_id: str) -> PointRequest | None:
    return db.scalar(select(PointRequest).where(PointRequest.request_id == request_id))


def _occurrence(db: Session, chore_id: int, user_id: int, day: date) -> ChoreCompletion | None:
    return db.scalar(
        select(ChoreCompletion).where(
            ChoreCompletion.chore_id == chore_id,
            ChoreCompletion.user_id == user_id,
            ChoreCompletion.on_date == day,
        )
    )


def _completion_out_or_none(row: ChoreCompletion | None) -> CompletionOut | None:
    return _completion_out(row) if row is not None else None


def _claim(
    db: Session,
    request_id: str | None,
    action: str,
    completion_id: int | None,
    redemption_id: int | None,
) -> bool:
    """Reserve `request_id`. False means it was already used, and this
    transaction has been rolled back so a retry can read the first result."""
    if request_id is None:
        return True
    db.add(
        PointRequest(
            request_id=request_id,
            action=action,
            completion_id=completion_id,
            redemption_id=redemption_id,
        )
    )
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        return False
    return True


def _open_redemption_for(db: Session, reward_id: int, user_id: int) -> RewardRedemption | None:
    return db.scalar(
        select(RewardRedemption)
        .where(
            RewardRedemption.reward_id == reward_id,
            RewardRedemption.user_id == user_id,
            RewardRedemption.status == "pending",
        )
        .options(selectinload(RewardRedemption.reward), selectinload(RewardRedemption.user))
    )


def _pending(db: Session, completion_id: int) -> ChoreCompletion:
    row = db.scalar(
        select(ChoreCompletion)
        .where(ChoreCompletion.id == completion_id)
        .options(selectinload(ChoreCompletion.chore))
    )
    if row is None or row.chore is None:
        raise HTTPException(404, "Completion not found")
    if row.status != "pending":
        raise HTTPException(400, "That chore is not waiting for approval")
    return row


def _board(db: Session, day: date) -> BoardOut:
    users = list(db.scalars(select(User).order_by(User.sort_order, User.id)))
    chores = list(
        db.scalars(
            select(Chore)
            .where(Chore.archived.is_(False))
            .order_by(Chore.title, Chore.id)
            .options(selectinload(Chore.assignees))
        )
    )
    completions = list(
        db.scalars(select(ChoreCompletion).where(ChoreCompletion.on_date == day))
    )
    by_key = {(row.chore_id, row.user_id): row for row in completions}
    stars = _balances(db)

    people: list[PersonBoard] = []
    for user in users:
        items: list[BoardChore] = []
        for chore in chores:
            if user.id not in {row.user_id for row in chore.assignees}:
                continue
            if not occurs_on(chore.schedule, chore.weekdays, chore.due_on, day):
                continue
            done = by_key.get((chore.id, user.id))
            items.append(
                BoardChore(
                    chore_id=chore.id,
                    title=chore.title,
                    notes=chore.notes,
                    icon=chore.icon,
                    points=chore.points,
                    requires_approval=chore.requires_approval,
                    schedule=chore.schedule,
                    completion=_completion_out(done) if done else None,
                )
            )
        people.append(
            PersonBoard(
                user_id=user.id,
                name=user.name,
                color=user.color,
                avatar_emoji=user.avatar_emoji,
                stars=stars.get(user.id, 0),
                chores=items,
            )
        )

    rewards = [
        _reward_out(row)
        for row in db.scalars(
            select(Reward).where(Reward.archived.is_(False)).order_by(Reward.points_cost, Reward.id)
        )
    ]
    pending_redemptions = [
        _redemption_out(row)
        for row in db.scalars(
            select(RewardRedemption)
            .where(RewardRedemption.status == "pending")
            .order_by(RewardRedemption.id)
            .options(selectinload(RewardRedemption.reward), selectinload(RewardRedemption.user))
        )
    ]
    approvals = []
    waiting = db.scalars(
        select(ChoreCompletion)
        .where(ChoreCompletion.status == "pending")
        .options(selectinload(ChoreCompletion.chore), selectinload(ChoreCompletion.user))
        .order_by(ChoreCompletion.on_date, ChoreCompletion.id)
    )
    for row in waiting:
        if row.chore is None or row.chore.archived or row.user is None:
            continue
        approvals.append(
            PendingApproval(
                completion_id=row.id,
                chore_id=row.chore_id,
                title=row.chore.title,
                user_id=row.user_id,
                user_name=row.user.name,
                color=row.user.color,
                points=row.chore.points,
                on=row.on_date,
            )
        )
    return BoardOut(
        on=day,
        people=people,
        rewards=rewards,
        pending_redemptions=pending_redemptions,
        pending_approvals=approvals,
    )


# -------------------------------- rewards ------------------------------------


@rewards_router.get("", response_model=list[RewardOut], summary="List rewards")
def list_rewards(db: Session = Depends(get_db)) -> list[RewardOut]:
    rows = db.scalars(
        select(Reward).where(Reward.archived.is_(False)).order_by(Reward.points_cost, Reward.id)
    )
    return [_reward_out(row) for row in rows]


@rewards_router.post("", response_model=RewardOut, status_code=201, summary="Create a reward")
def create_reward(payload: RewardIn, db: Session = Depends(get_db)) -> RewardOut:
    row = Reward(
        title=payload.title.strip(),
        description=payload.description,
        points_cost=payload.points_cost,
        icon=(payload.icon or "").strip() or _guess_reward_icon(payload.title),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _reward_out(row)


@rewards_router.patch("/{reward_id}", response_model=RewardOut, summary="Edit a reward")
def update_reward(
    reward_id: int, payload: RewardUpdate, db: Session = Depends(get_db)
) -> RewardOut:
    row = _load_reward(db, reward_id)
    changes = payload.model_dump(exclude_unset=True)
    if "title" in changes and changes["title"] is not None:
        row.title = changes["title"].strip()
    if "description" in changes:
        row.description = changes["description"]
    if "points_cost" in changes and changes["points_cost"] is not None:
        row.points_cost = changes["points_cost"]
    if "icon" in changes:
        row.icon = (changes["icon"] or "").strip() or _guess_reward_icon(row.title)
    db.commit()
    db.refresh(row)
    return _reward_out(row)


@rewards_router.delete(
    "/{reward_id}",
    status_code=204,
    summary="Retire a reward",
    description=(
        "The reward leaves the catalog. A request that was still open is sent back and "
        "the stars return. A reward that was already given stays given."
    ),
)
def delete_reward(reward_id: int, db: Session = Depends(get_db)) -> None:
    row = _load_reward(db, reward_id)
    pending = db.scalars(
        select(RewardRedemption)
        .where(RewardRedemption.reward_id == row.id, RewardRedemption.status == "pending")
        .options(selectinload(RewardRedemption.reward))
    )
    for redemption in pending:
        _refund(db, redemption)
    row.archived = True
    db.commit()


@rewards_router.post(
    "/{reward_id}/redeem",
    response_model=RedemptionOut,
    status_code=201,
    summary="Spend stars on a reward",
    description=(
        "Stars are held immediately. The same `request_id`, or a second tap while "
        "this reward is still waiting to be given, returns the open request and "
        "does not spend the stars again."
    ),
)
def redeem(reward_id: int, payload: RedeemIn, db: Session = Depends(get_db)) -> RedemptionOut:
    reward = _load_reward(db, reward_id)
    user = db.get(User, payload.user_id)
    if user is None:
        raise HTTPException(404, "User not found")
    request_id = _request_id(payload.request_id)
    if request_id is not None:
        prior = _prior_request(db, request_id)
        if prior is not None:
            if prior.action != "redeem" or prior.redemption_id is None:
                raise HTTPException(409, "request_id was already used")
            return _redemption_out(_load_redemption(db, prior.redemption_id))

    open_request = _open_redemption_for(db, reward.id, user.id)
    if open_request is not None:
        if not _claim(db, request_id, "redeem", None, open_request.id):
            prior = _prior_request(db, request_id) if request_id else None
            if prior is not None and prior.redemption_id is not None:
                return _redemption_out(_load_redemption(db, prior.redemption_id))
            return _redemption_out(open_request)
        db.commit()
        return _redemption_out(open_request)

    balance = _balances(db).get(user.id, 0)
    if balance < reward.points_cost:
        raise HTTPException(
            400,
            f"Not enough stars. {user.name} has {balance} and this costs {reward.points_cost}.",
        )
    redemption = RewardRedemption(
        reward_id=reward.id,
        user_id=user.id,
        points_spent=reward.points_cost,
        status="pending",
        created_at=utcnow(),
    )
    db.add(redemption)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        open_request = _open_redemption_for(db, reward.id, user.id)
        if open_request is None:
            raise
        return _redemption_out(open_request)
    if not _claim(db, request_id, "redeem", None, redemption.id):
        prior = _prior_request(db, request_id) if request_id else None
        if prior is not None and prior.redemption_id is not None:
            return _redemption_out(_load_redemption(db, prior.redemption_id))
        again = _open_redemption_for(db, reward.id, user.id)
        if again is None:
            raise HTTPException(409, "request_id was already used")
        return _redemption_out(again)
    _award(
        db,
        user.id,
        -reward.points_cost,
        "reward",
        reward.title,
        redemption_id=redemption.id,
    )
    db.commit()
    return _redemption_out(_load_redemption(db, redemption.id))


def _load_reward(db: Session, reward_id: int) -> Reward:
    row = db.get(Reward, reward_id)
    if row is None or row.archived:
        raise HTTPException(404, "Reward not found")
    return row


def _refund(db: Session, redemption: RewardRedemption) -> None:
    title = redemption.reward.title if redemption.reward else "Reward"
    _award(
        db,
        redemption.user_id,
        redemption.points_spent,
        "reversal",
        f"{title} sent back",
        redemption_id=redemption.id,
    )
    redemption.status = "denied"
    redemption.resolved_at = utcnow()


@redemptions_router.post(
    "/{redemption_id}/fulfill",
    response_model=RedemptionOut,
    summary="Mark a reward as given",
    description="Stars were already spent when it was requested. This does not charge them again.",
)
def fulfill(redemption_id: int, db: Session = Depends(get_db)) -> RedemptionOut:
    row = _open_redemption(db, redemption_id)
    row.status = "fulfilled"
    row.resolved_at = utcnow()
    db.commit()
    return _redemption_out(_load_redemption(db, row.id))


@redemptions_router.post(
    "/{redemption_id}/deny",
    response_model=RedemptionOut,
    summary="Send a reward request back",
    description="The stars that were held are returned.",
)
def deny(redemption_id: int, db: Session = Depends(get_db)) -> RedemptionOut:
    row = _open_redemption(db, redemption_id)
    _refund(db, row)
    db.commit()
    return _redemption_out(_load_redemption(db, row.id))


def _open_redemption(db: Session, redemption_id: int) -> RewardRedemption:
    row = _load_redemption(db, redemption_id)
    if row.status != "pending":
        raise HTTPException(400, "That request was already handled")
    return row
