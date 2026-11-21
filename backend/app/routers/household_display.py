from datetime import date
from threading import Lock
from time import monotonic
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import MealPlanEntry

router = APIRouter(tags=["household display"])
Meal = Literal["breakfast", "lunch", "dinner"]
Destination = Literal["today", "week", "month", "lists", "photos", "meals"]


class MealEdit(BaseModel):
    day: date
    meal: Meal
    title: str = Field(max_length=200)


@router.get("/meals")
def meals(start: date, end: date, db: Session = Depends(get_db)):
    if not 0 <= (end - start).days <= 31:
        raise HTTPException(422, "Choose a date range of at most 32 days.")
    rows = db.scalars(select(MealPlanEntry).where(
        MealPlanEntry.key >= start.isoformat(),
        MealPlanEntry.key <= end.isoformat() + "~",
    ))
    return {row.key: row.title for row in rows}


@router.post("/meals")
def save_meal(edit: MealEdit, db: Session = Depends(get_db)):
    key = f"{edit.day}:{edit.meal}"
    title = edit.title.strip()
    if title:
        db.merge(MealPlanEntry(key=key, title=title))
    elif row := db.get(MealPlanEntry, key):
        db.delete(row)
    db.commit()
    return {"key": key, "title": title}


class DisplayCommand(BaseModel):
    destination: Destination


class DisplayPoll(BaseModel):
    name: str = Field(min_length=1, max_length=48)


# Display presence and commands are ephemeral. An offline TV should never
# switch pages when it eventually reconnects.
_lock = Lock()
_displays: dict[UUID, tuple[str, float]] = {}
_commands: dict[UUID, Destination] = {}


def _expire(now: float):
    for key, (_, seen) in list(_displays.items()):
        if now - seen > 15:
            del _displays[key]
            _commands.pop(key, None)


@router.post("/displays/{display_id}/poll")
def poll_display(display_id: UUID, polling: DisplayPoll):
    with _lock:
        now = monotonic()
        _expire(now)
        if display_id not in _displays and len(_displays) >= 64:
            raise HTTPException(429, "Too many connected displays.")
        _displays[display_id] = (polling.name, now)
        return {"destination": _commands.pop(display_id, None)}


@router.get("/displays")
def displays():
    with _lock:
        _expire(monotonic())
        return [{"id": str(key), "name": name} for key, (name, _) in _displays.items()]


@router.post("/displays/{display_id}/show")
def show_on_display(display_id: UUID, command: DisplayCommand):
    with _lock:
        _expire(monotonic())
        if display_id not in _displays:
            raise HTTPException(404, "Open Mantel on that TV and try again.")
        _commands[display_id] = command.destination
    return {"queued": True}
