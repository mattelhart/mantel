import { describe, type EditItem, type EditRoom, type EditView } from './homeModel'

/** Everything Edit mode can do, as plain callbacks, so the page owns the draft. Moves are
 *  one step earlier or later: buttons, not dragging, because they work the same with a
 *  finger on the wall, a mouse and a D-pad. */
export interface EditHandlers {
  moveRoom: (key: string, delta: -1 | 1) => void
  toggleRoom: (key: string) => void
  toggleWide: (key: string) => void
  moveDevice: (roomKey: string, id: string, delta: -1 | 1) => void
  toggleDevice: (id: string) => void
  moveScene: (id: string, delta: -1 | 1) => void
}

type Icons = Record<string, string>

function Arrows({
  name,
  first,
  last,
  onMove,
}: {
  name: string
  first: boolean
  last: boolean
  onMove: (delta: -1 | 1) => void
}) {
  return (
    <>
      <button type="button" className="btn home-edit__btn" aria-label={`Move ${name} earlier`} disabled={first} onClick={() => onMove(-1)}>
        ◀
      </button>
      <button type="button" className="btn home-edit__btn" aria-label={`Move ${name} later`} disabled={last} onClick={() => onMove(1)}>
        ▶
      </button>
    </>
  )
}

function EditTile({
  item,
  icons,
  first,
  last,
  onMove,
  onToggle,
}: {
  item: EditItem
  icons: Icons
  first: boolean
  last: boolean
  onMove: (delta: -1 | 1) => void
  onToggle: () => void
}) {
  const { entity } = item
  return (
    <div className="home-tile home-tile--edit" data-hidden={item.hidden}>
      <div className="home-tile__main home-tile__main--edit">
        <span className="home-tile__icon" aria-hidden>{icons[entity.domain] ?? '•'}</span>
        <span className="home-tile__name">{entity.name}</span>
        <span className="home-tile__state">{item.hidden ? 'Hidden' : describe(entity)}</span>
      </div>
      <div className="home-edit__tools">
        <Arrows name={entity.name} first={first} last={last} onMove={onMove} />
        <button
          type="button"
          className="btn home-edit__btn home-edit__btn--text"
          aria-pressed={item.hidden}
          aria-label={`${item.hidden ? 'Show' : 'Hide'} ${entity.name}`}
          onClick={onToggle}
        >
          {item.hidden ? 'Show' : 'Hide'}
        </button>
      </div>
    </div>
  )
}

function EditRoomCard({
  room,
  index,
  count,
  icons,
  on,
}: {
  room: EditRoom
  index: number
  count: number
  icons: Icons
  on: EditHandlers
}) {
  return (
    <section
      className={`home-room home-room--edit${room.wide ? ' home-room--wide' : ''}`}
      data-hidden={room.hidden}
      aria-label={room.name}
    >
      <header className="home-room__head">
        <h2 className="home-room__title">{room.name}</h2>
        {room.hidden && <span className="home-room__sum">Hidden</span>}
      </header>
      <div className="home-edit__tools home-edit__tools--room">
        <Arrows name={room.name} first={index === 0} last={index === count - 1} onMove={(d) => on.moveRoom(room.key, d)} />
        <button
          type="button"
          className="btn home-edit__btn home-edit__btn--text"
          aria-pressed={room.wide}
          aria-label={`${room.name} wide`}
          onClick={() => on.toggleWide(room.key)}
        >
          {room.wide ? 'Wide ✓' : 'Wide'}
        </button>
        <button
          type="button"
          className="btn home-edit__btn home-edit__btn--text"
          aria-pressed={room.hidden}
          aria-label={`${room.hidden ? 'Show' : 'Hide'} ${room.name} room`}
          onClick={() => on.toggleRoom(room.key)}
        >
          {room.hidden ? 'Show room' : 'Hide room'}
        </button>
      </div>
      <div className="home-room__tiles">
        {room.items.map((item, i) => (
          <EditTile
            key={item.entity.entity_id}
            item={item}
            icons={icons}
            first={i === 0}
            last={i === room.items.length - 1}
            onMove={(d) => on.moveDevice(room.key, item.entity.entity_id, d)}
            onToggle={() => on.toggleDevice(item.entity.entity_id)}
          />
        ))}
      </div>
    </section>
  )
}

/** The page body while arranging: scene chips, then every room with its controls. */
export function HomeEditor({ view, icons, on }: { view: EditView; icons: Icons; on: EditHandlers }) {
  return (
    <>
      {view.scenes.length > 0 && (
        <section className="home__scenes home__scenes--edit" aria-label="Scenes">
          {view.scenes.map((item, i) => (
            <div key={item.entity.entity_id} className="home-scene-edit" data-hidden={item.hidden}>
              <span className="home-scene-edit__name">
                <span aria-hidden>{icons[item.entity.domain]}</span> {item.entity.name}
                {item.hidden && <span className="home-scene-edit__flag"> · Hidden</span>}
              </span>
              <Arrows
                name={item.entity.name}
                first={i === 0}
                last={i === view.scenes.length - 1}
                onMove={(d) => on.moveScene(item.entity.entity_id, d)}
              />
              <button
                type="button"
                className="btn home-edit__btn home-edit__btn--text"
                aria-pressed={item.hidden}
                aria-label={`${item.hidden ? 'Show' : 'Hide'} ${item.entity.name}`}
                onClick={() => on.toggleDevice(item.entity.entity_id)}
              >
                {item.hidden ? 'Show' : 'Hide'}
              </button>
            </div>
          ))}
        </section>
      )}
      <div className="home__rooms">
        {view.rooms.map((room, i) => (
          <EditRoomCard key={room.key} room={room} index={i} count={view.rooms.length} icons={icons} on={on} />
        ))}
      </div>
    </>
  )
}
