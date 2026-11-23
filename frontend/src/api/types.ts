import type { HomeLayoutPrefs } from '../views/home/homeModel'

export interface User {
  id: number
  name: string
  color: string
  avatar_emoji: string | null
  sort_order: number
  phone?: string | null
}

/** A connected Google or iCloud account. Credentials are never sent to the client. */
export interface LinkedAccount {
  id: number
  user_id: number
  provider: string
  email: string
  status: string
  last_error: string | null
}

export interface SyncStatus {
  google_configured: boolean
  icloud_linked: boolean
  sync_enabled: boolean
  interval_seconds: number
  /** Emails of accounts that stopped working, whichever service they belong to. */
  accounts_needing_reauth: string[]
  pending_pushes: number
  calendars: {
    calendar_id: number
    name: string
    account_email: string | null
    sync_enabled: boolean
    last_synced_at: string | null
    sync_error: string | null
  }[]
}

export interface CalendarInfo {
  id: number
  name: string
  is_local: boolean
  google_calendar_id: string | null
  linked_account_id: number | null
  account_email: string | null
  /** 'google' or 'icloud'; null for a calendar that lives only in this app. */
  account_provider: string | null
  claimed_by_user_id: number | null
  color: string
  sync_enabled: boolean
  access_role: string
  writable: boolean
  last_synced_at: string | null
  sync_error: string | null
}

export interface CalendarEvent {
  id: number
  calendar_id: number
  calendar_name: string
  color: string
  user_id: number | null
  title: string
  description: string | null
  location: string | null
  start_at: string
  end_at: string
  all_day: boolean
  timezone: string | null
  recurring: boolean
  recurrence_rule: string | null
  recurrence_text: string | null
  origin: 'local' | 'google' | 'icloud'
  sync_state: string
  editable: boolean
}

export interface EventInput {
  calendar_id: number
  title: string
  description?: string | null
  location?: string | null
  start_at: string
  end_at: string
  all_day?: boolean
  recurrence_rule?: string | null
}

export interface Photo {
  id: number
  original_name: string | null
  width: number
  height: number
  size_bytes: number
  sort_order: number
  url: string
}

export interface WeatherDay {
  date: string
  high: number | null
  low: number | null
  pop: number
  short: string | null
}

export interface Weather {
  available: boolean
  stale: boolean
  reason?: string
  provider?: string
  units?: string
  place?: string | null
  current?: {
    temp: number | null
    feels_like: number | null
    humidity: number | null
    short: string | null
    pop: number
    wind: string | null
    wind_direction: string | null
    is_daytime: boolean
  } | null
  days?: WeatherDay[]
  hourly?: { time: string; temp: number | null; pop: number; short: string | null }[]
  alerts?: { event: string; severity: string; headline: string }[]
}

export interface PlaceMatch {
  name: string
  admin1: string | null
  country: string | null
  latitude: number
  longitude: number
  label: string
}

export interface ListItem {
  id: number
  list_id: number
  text: string
  checked: boolean
  assigned_user_id: number | null
  color: string | null
  sort_order: number
}

export interface SharedList {
  id: number
  name: string
  icon: string | null
  sort_order: number
  item_count: number
  items: ListItem[]
}

export interface ChoreCompletion {
  id: number
  chore_id: number
  user_id: number
  on: string
  status: 'pending' | 'done'
  points_awarded: number
}

export interface ChoreDef {
  id: number
  title: string
  notes: string | null
  points: number
  schedule: 'daily' | 'weekly' | 'once'
  weekdays: number[]
  due_on: string | null
  requires_approval: boolean
  icon: string | null
  assignee_ids: number[]
}

export interface BoardChore {
  chore_id: number
  title: string
  notes: string | null
  icon: string | null
  points: number
  requires_approval: boolean
  schedule: string
  completion: ChoreCompletion | null
}

export interface PersonBoard {
  user_id: number
  name: string
  color: string
  avatar_emoji: string | null
  stars: number
  chores: BoardChore[]
}

export interface Reward {
  id: number
  title: string
  description: string | null
  points_cost: number
  icon: string | null
}

export interface Redemption {
  id: number
  reward_id: number
  reward_title: string
  user_id: number
  user_name: string
  color: string
  points_spent: number
  status: string
}

export interface PendingApproval {
  completion_id: number
  chore_id: number
  title: string
  user_id: number
  user_name: string
  color: string
  points: number
  on: string
}

export interface ChoreBoard {
  on: string
  people: PersonBoard[]
  rewards: Reward[]
  pending_redemptions: Redemption[]
  pending_approvals: PendingApproval[]
}

export interface AppSettings {
  first_day_of_week: number
  time_format_24h: boolean
  home_timezone: string
  default_view: string
  kiosk_default_route: string
  display_scale: 'normal' | 'large' | 'wall'
  theme: 'midnight' | 'daylight' | 'hearth' | 'airy'
  bookmark_label: string
  bookmark_url: string
  day_start_hour: number
  day_end_hour: number
  screensaver_enabled: boolean
  screensaver_delay_minutes: number
  screensaver_mode: 'auto' | 'photos' | 'clock' | 'off'
  screensaver_shuffle: boolean
  screensaver_seconds_per_photo: number
  sleep_enabled: boolean
  sleep_start_hour: number
  sleep_end_hour: number
  burn_in_shift: boolean
  weather_enabled: boolean
  weather_lat: number | null
  weather_lon: number | null
  weather_place: string
  weather_provider: 'auto' | 'nws' | 'open-meteo'
  weather_units: 'imperial' | 'metric'
  ha_base_url: string
  ha_token: string
  ha_entity_id: string
  /** Home Control: entity ids pinned to the top, and ones kept off the wall. */
  home_favorites: string[]
  home_hidden: string[]
  /** How Home Control is arranged, one value for every screen (see homeModel.ts). */
  home_layout?: HomeLayoutPrefs
  google_client_id: string
  google_client_secret: string
  public_base_url: string
  twilio_account_sid?: string
  twilio_auth_token?: string
  twilio_from_number?: string
  message_provider?: 'twilio' | 'signal'
  signal_api_url?: string
  signal_account_number?: string
  server: {
    version: string
    google_configured: boolean
    icloud_linked: boolean
    google_client_secret_set: boolean
    ha_token_set: boolean
    twilio_account_sid_set?: boolean
    twilio_auth_token_set?: boolean
    twilio_configured?: boolean
    signal_configured?: boolean
    messages_configured?: boolean
    messages_provider?: 'twilio' | 'signal'
    google_redirect_uri: string
    sync_enabled: boolean
    sync_interval_seconds: number
  }
}
