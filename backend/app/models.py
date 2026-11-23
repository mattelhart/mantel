from datetime import UTC, date, datetime

from sqlalchemy import (
    JSON,
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


def utcnow() -> datetime:
    """Naive UTC: SQLite has no timezone storage, so every timestamp in the database is
    UTC without an offset and is re-tagged as UTC on the way out."""
    return datetime.now(UTC).replace(tzinfo=None)


class Base(DeclarativeBase):
    pass


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )


class User(TimestampMixin, Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    color: Mapped[str] = mapped_column(String(9), nullable=False, default="#3b82f6")
    avatar_emoji: Mapped[str | None] = mapped_column(String(16))
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    # Optional E.164 number used by family messaging. Nullable so existing
    # databases can gain the column automatically (see schema_sync.py).
    phone: Mapped[str | None] = mapped_column(String(20))
    # Signal ACI, used when a member hides their number. Nullable, auto-added.
    signal_uuid: Mapped[str | None] = mapped_column(String(36))

    accounts: Mapped[list["LinkedAccount"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    messages: Mapped[list["FamilyMessage"]] = relationship(
        back_populates="user",
    )


class LinkedAccount(TimestampMixin, Base):
    __tablename__ = "linked_accounts"
    __table_args__ = (UniqueConstraint("provider", "email", name="uq_provider_email"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    # "google" or "icloud". Everything downstream dispatches on this, so it is also
    # what `Event.origin` is set to for events pulled through this account.
    provider: Mapped[str] = mapped_column(String(32), default="google")
    email: Mapped[str] = mapped_column(String(255), nullable=False)

    # Google only: OAuth tokens.
    access_token_enc: Mapped[str | None] = mapped_column(Text)
    refresh_token_enc: Mapped[str | None] = mapped_column(Text)
    token_expiry: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # iCloud only. Apple has no OAuth for calendars, so the credential is an
    # app-specific password that never expires on its own -- kept in its own column
    # rather than sharing `refresh_token_enc`, which the Google refresh path reads.
    password_enc: Mapped[str | None] = mapped_column(Text)
    # Cached CalDAV calendar-home, so the two-step principal discovery does not run
    # on every sync.
    calendar_home_url: Mapped[str | None] = mapped_column(String(500))

    status: Mapped[str] = mapped_column(String(32), default="active")
    last_error: Mapped[str | None] = mapped_column(Text)

    user: Mapped[User] = relationship(back_populates="accounts")
    calendars: Mapped[list["Calendar"]] = relationship(
        back_populates="account", cascade="all, delete-orphan"
    )


class Calendar(TimestampMixin, Base):
    __tablename__ = "calendars"
    __table_args__ = (
        UniqueConstraint("linked_account_id", "google_calendar_id", name="uq_account_gcal"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    linked_account_id: Mapped[int | None] = mapped_column(
        ForeignKey("linked_accounts.id", ondelete="CASCADE")
    )
    # Whatever the provider calls this calendar: a Google calendar id, or a CalDAV
    # collection path like /1234567890/calendars/home/. The column keeps its
    # original name because the uniqueness that stops duplicate rows lives in
    # `uq_account_gcal`, and the startup migrator cannot recreate a constraint on an
    # existing table. Read it through `remote_id` in provider-agnostic code.
    google_calendar_id: Mapped[str | None] = mapped_column(String(255))
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    color_override: Mapped[str | None] = mapped_column(String(9))
    claimed_by_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )

    sync_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    sync_token: Mapped[str | None] = mapped_column(Text)
    last_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    sync_error: Mapped[str | None] = mapped_column(Text)
    access_role: Mapped[str] = mapped_column(String(32), default="owner")

    account: Mapped[LinkedAccount | None] = relationship(back_populates="calendars")
    claimed_by: Mapped[User | None] = relationship()
    events: Mapped[list["Event"]] = relationship(
        back_populates="calendar", cascade="all, delete-orphan"
    )

    @property
    def is_local(self) -> bool:
        return self.linked_account_id is None

    @property
    def writable(self) -> bool:
        return self.is_local or self.access_role in ("owner", "writer")

    @property
    def remote_id(self) -> str | None:
        """Provider-neutral name for `google_calendar_id`."""
        return self.google_calendar_id

    @remote_id.setter
    def remote_id(self, value: str | None) -> None:
        self.google_calendar_id = value


class Event(TimestampMixin, Base):
    __tablename__ = "events"
    __table_args__ = (
        UniqueConstraint("calendar_id", "google_event_id", name="uq_calendar_gevent"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    calendar_id: Mapped[int] = mapped_column(ForeignKey("calendars.id", ondelete="CASCADE"))
    # The provider's handle on this event. For Google, its event id. For CalDAV, the
    # resource filename inside the calendar collection ("A1B2C3.ics") -- filename
    # only, so moving a collection does not orphan every row. A recurrence override
    # that shares a resource with its master is stored as "<filename>#<recurrence-id>",
    # which keeps it unique within the calendar. See `remote_id` for the neutral name.
    google_event_id: Mapped[str | None] = mapped_column(String(1024))
    # Google's etag, or the CalDAV ETag used for If-Match on update and delete.
    google_etag: Mapped[str | None] = mapped_column(String(255))

    title: Mapped[str] = mapped_column(String(500), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    location: Mapped[str | None] = mapped_column(String(500))

    start_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    end_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    all_day: Mapped[bool] = mapped_column(Boolean, default=False)
    timezone: Mapped[str | None] = mapped_column(String(64))

    recurrence_rule: Mapped[str | None] = mapped_column(Text)
    recurring_event_id: Mapped[str | None] = mapped_column(String(1024))
    # Occurrences of `recurrence_rule` that must not be rendered, as comma-separated
    # naive-UTC ISO timestamps. Two things land here: a real EXDATE from a CalDAV
    # master, and a synthesized one for every RECURRENCE-ID override, which is stored
    # as its own row and would otherwise be drawn twice. Google never sets this --
    # it expands series itself and simply stops sending the cancelled instance.
    exdates: Mapped[str | None] = mapped_column(Text)
    # True once a recurring event has been handed to a provider that expands series
    # itself. Google does, and then returns its own instances, so the master must
    # stop being displayed or every occurrence would appear twice. CalDAV does not:
    # it hands back the master untouched, so iCloud series stay False and are
    # expanded locally. See `CalendarProvider.expands_recurrence`.
    is_master: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    # Last occurrence of a finite series, so a rule that finished years ago can be
    # excluded in SQL instead of being re-expanded on every calendar query. NULL
    # means either "not recurring" or "never ends".
    recurrence_end: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    status: Mapped[str] = mapped_column(String(32), default="confirmed")
    # "local", or the `provider` of the account this came from ("google"/"icloud").
    # A full resync clears only the rows the provider itself gave us, so anything
    # created here and not yet pushed survives.
    origin: Mapped[str] = mapped_column(String(16), default="local")
    sync_state: Mapped[str] = mapped_column(String(32), default="synced", index=True)
    local_updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )
    remote_updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    calendar: Mapped[Calendar] = relationship(back_populates="events")

    @property
    def remote_id(self) -> str | None:
        """Provider-neutral name for `google_event_id`."""
        return self.google_event_id

    @remote_id.setter
    def remote_id(self, value: str | None) -> None:
        self.google_event_id = value

    @property
    def remote_etag(self) -> str | None:
        """Provider-neutral name for `google_etag`."""
        return self.google_etag

    @remote_etag.setter
    def remote_etag(self, value: str | None) -> None:
        self.google_etag = value


class DashboardWidget(TimestampMixin, Base):
    __tablename__ = "dashboard_widgets"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    widget_type: Mapped[str] = mapped_column(String(64), nullable=False)
    position: Mapped[int] = mapped_column(Integer, default=0)
    size: Mapped[str] = mapped_column(String(16), default="medium")
    config: Mapped[dict] = mapped_column(JSON, default=dict)


class Photo(TimestampMixin, Base):
    """Screensaver photos. The file itself lives on disk under PHOTO_DIR; only the
    generated filename is stored, never anything the uploader controls."""

    __tablename__ = "photos"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    filename: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    original_name: Mapped[str | None] = mapped_column(String(255))
    content_type: Mapped[str] = mapped_column(String(32), nullable=False)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    width: Mapped[int] = mapped_column(Integer, nullable=False)
    height: Mapped[int] = mapped_column(Integer, nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)


class ShoppingList(TimestampMixin, Base):
    """A shared list -- groceries, chores, packing. Not per-user: the whole point
    is that anyone in the house can add to it from any screen."""

    __tablename__ = "lists"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    icon: Mapped[str | None] = mapped_column(String(16))
    sort_order: Mapped[int] = mapped_column(Integer, default=0)

    items: Mapped[list["ListItem"]] = relationship(
        back_populates="list", cascade="all, delete-orphan"
    )


class ListItem(TimestampMixin, Base):
    __tablename__ = "list_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    list_id: Mapped[int] = mapped_column(ForeignKey("lists.id", ondelete="CASCADE"), index=True)
    text: Mapped[str] = mapped_column(String(500), nullable=False)
    checked: Mapped[bool] = mapped_column(Boolean, default=False)
    assigned_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    sort_order: Mapped[int] = mapped_column(Integer, default=0)

    list: Mapped[ShoppingList] = relationship(back_populates="items")
    assigned_to: Mapped[User | None] = relationship()


class Chore(TimestampMixin, Base):
    """A repeating or one-off job assigned to one or more people.

    Each assignee completes their own copy. Stars are not stored on the chore:
    a completion writes a row in `star_entries`, and the balance is the sum, so
    unchecking or sending a reward back is another row rather than an edit of
    history.
    """

    __tablename__ = "chores"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    notes: Mapped[str | None] = mapped_column(Text)
    # What the person earns for this occurrence. Zero is a chore with no prize.
    points: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    # daily: every day. weekly: the days in `weekdays`. once: `due_on` only.
    schedule: Mapped[str] = mapped_column(String(16), nullable=False, default="daily")
    # Comma-separated 0–6, Sunday = 0, matching `first_day_of_week`. Weekly only.
    weekdays: Mapped[str | None] = mapped_column(String(20))
    due_on: Mapped[date | None] = mapped_column(Date)
    # When set, checking the chore waits for someone to approve before stars land.
    requires_approval: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    icon: Mapped[str | None] = mapped_column(String(16))
    # Retired chores leave the board but keep their completions, so star history
    # still points at a real row.
    archived: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    assignees: Mapped[list["ChoreAssignee"]] = relationship(
        back_populates="chore", cascade="all, delete-orphan"
    )
    completions: Mapped[list["ChoreCompletion"]] = relationship(
        back_populates="chore", cascade="all, delete-orphan"
    )


class ChoreAssignee(Base):
    """One person the chore is for. A shared chore is several of these, and each
    person checks off their own — finishing yours does not finish theirs."""

    __tablename__ = "chore_assignees"
    __table_args__ = (UniqueConstraint("chore_id", "user_id", name="uq_chore_assignee"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    chore_id: Mapped[int] = mapped_column(ForeignKey("chores.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)

    chore: Mapped[Chore] = relationship(back_populates="assignees")
    user: Mapped[User] = relationship()


class ChoreCompletion(Base):
    """One person's answer for one occurrence of a chore.

    `on_date` is a calendar day in the household timezone, not an instant: the
    chore is "Tuesday's dishes", and Tuesday does not move when the clocks do.
    """

    __tablename__ = "chore_completions"
    __table_args__ = (
        UniqueConstraint("chore_id", "user_id", "on_date", name="uq_chore_occurrence"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    chore_id: Mapped[int] = mapped_column(ForeignKey("chores.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    on_date: Mapped[date] = mapped_column(Date, nullable=False)
    # pending: checked, waiting for approval. done: stars have been awarded
    # (or the chore was worth zero).
    status: Mapped[str] = mapped_column(String(16), nullable=False)
    points_awarded: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    completed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    chore: Mapped[Chore] = relationship(back_populates="completions")
    user: Mapped[User] = relationship()


class StarEntry(Base):
    """One movement of a person's star balance. The balance is the sum of these.

    Reversals are new rows. Editing a past delta would make "why does Sam have
    12 stars" impossible to answer after a chore was unchecked.
    """

    __tablename__ = "star_entries"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    delta: Mapped[int] = mapped_column(Integer, nullable=False)
    # chore, reward, or reversal. The linked id says which row it came from.
    reason: Mapped[str] = mapped_column(String(32), nullable=False)
    # Kept after the completion or redemption row is gone, so a reversal still
    # says what it undid.
    note: Mapped[str | None] = mapped_column(String(200))
    chore_completion_id: Mapped[int | None] = mapped_column(
        ForeignKey("chore_completions.id", ondelete="SET NULL")
    )
    redemption_id: Mapped[int | None] = mapped_column(
        ForeignKey("reward_redemptions.id", ondelete="SET NULL")
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Reward(TimestampMixin, Base):
    """Something stars can be spent on. Redeeming creates a request a person at
    the wall can mark as given, or send back so the stars return."""

    __tablename__ = "rewards"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    points_cost: Mapped[int] = mapped_column(Integer, nullable=False)
    icon: Mapped[str | None] = mapped_column(String(16))
    archived: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    redemptions: Mapped[list["RewardRedemption"]] = relationship(back_populates="reward")


class RewardRedemption(Base):
    __tablename__ = "reward_redemptions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    reward_id: Mapped[int] = mapped_column(ForeignKey("rewards.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    points_spent: Mapped[int] = mapped_column(Integer, nullable=False)
    # pending: asked for, stars already held. fulfilled: it was given.
    # denied: sent back, stars returned.
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="pending")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    reward: Mapped[Reward] = relationship(back_populates="redemptions")
    user: Mapped[User] = relationship()

    __table_args__ = (
        # One open request per person per reward. A second tap, or a retry that
        # minted a new id, finds this row instead of spending the stars again.
        # Fulfilled and denied rows drop out of the index, so the reward can be
        # bought again later.
        Index(
            "uq_open_redemption",
            "user_id",
            "reward_id",
            unique=True,
            sqlite_where=text("status = 'pending'"),
        ),
    )


class PointRequest(Base):
    """The id a screen chose for one tap.

    Posting the same `request_id` again is the same tap: the handler returns
    what already happened and does not write another star entry. The balance
    stays the sum of `star_entries`.
    """

    __tablename__ = "point_requests"
    __table_args__ = (UniqueConstraint("request_id", name="uq_point_request"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    request_id: Mapped[str] = mapped_column(String(64), nullable=False)
    # complete, undo, or redeem.
    action: Mapped[str] = mapped_column(String(16), nullable=False)
    completion_id: Mapped[int | None] = mapped_column(
        ForeignKey("chore_completions.id", ondelete="SET NULL")
    )
    redemption_id: Mapped[int | None] = mapped_column(
        ForeignKey("reward_redemptions.id", ondelete="SET NULL")
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)



class FamilyMessage(TimestampMixin, Base):
    """One SMS or MMS between the wall and a phone, via Twilio.

    Conversations are derived: one thread per family member, plus a thread per
    inbound number that is not saved on a person. `user_id` is null for those
    unknown numbers. The Twilio SID is unique so a poller can run often without
    duplicating a message.
    """

    __tablename__ = "family_messages"
    __table_args__ = (
        UniqueConstraint("twilio_sid", name="uq_family_message_sid"),
        Index("ix_family_messages_phone_created", "phone", "created_at"),
        Index("ix_family_messages_user_created", "user_id", "created_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    request_id: Mapped[str | None] = mapped_column(String(80), unique=True, index=True)
    request_digest: Mapped[str | None] = mapped_column(String(64))
    # E.164 of the other party (the family member, or an unknown sender).
    # Empty when Signal hid the number and we only have a UUID.
    phone: Mapped[str] = mapped_column(String(20), nullable=False)
    # Signal ACI of the other party, when the envelope included one.
    signal_uuid: Mapped[str | None] = mapped_column(String(36))
    # Profile name from an unlinked Signal sender, so a grown-up can match them.
    sender_name: Mapped[str | None] = mapped_column(String(100))
    # "in" (they texted the wall) or "out" (the wall sent it).
    direction: Mapped[str] = mapped_column(String(8), nullable=False)
    body: Mapped[str | None] = mapped_column(Text)
    # Filename only, under the data directory's messages/ folder.
    media_path: Mapped[str | None] = mapped_column(String(80))
    media_content_type: Mapped[str | None] = mapped_column(String(80))
    # Twilio status: queued, sending, sent, delivered, undelivered, failed, received.
    status: Mapped[str] = mapped_column(String(32), default="queued")
    twilio_sid: Mapped[str | None] = mapped_column(String(64))
    error_message: Mapped[str | None] = mapped_column(Text)

    user: Mapped["User | None"] = relationship(back_populates="messages")



class WeatherCache(Base):
    """Raw upstream responses, keyed by request. Kept in the database rather than
    memory so a restart doesn't leave the wall display blank until the next fetch."""

    __tablename__ = "weather_cache"

    key: Mapped[str] = mapped_column(String(255), primary_key=True)
    payload: Mapped[str] = mapped_column(Text, nullable=False)
    fetched_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class AppSetting(Base):
    __tablename__ = "app_settings"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[dict] = mapped_column(JSON, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )


class Device(TimestampMixin, Base):
    """A phone or browser that has been paired with this install.

    The token itself is never stored. `token_hash` is SHA-256 of the secret the
    device sends as a bearer; `token_prefix` is the only fragment the settings
    screen can show, so a revoke button can be matched to a phone without
    keeping the credential.
    """

    __tablename__ = "devices"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    token_prefix: Mapped[str] = mapped_column(String(20), nullable=False)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class PairingCode(Base):
    """A short-lived code shown on the wall and typed (or scanned) by a phone.

    Hashed, like a device token: the database should not contain a live code
    in a form that can be replayed. Single use. The wall creates these; the
    exchange endpoint that consumes them is unauthenticated, because the phone
    has no token yet — the code is the credential.
    """

    __tablename__ = "pairing_codes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    code_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class MealPlanEntry(Base):
    __tablename__ = "meal_plan_entries"

    key: Mapped[str] = mapped_column(String(24), primary_key=True)
    title: Mapped[str] = mapped_column(String(200))
