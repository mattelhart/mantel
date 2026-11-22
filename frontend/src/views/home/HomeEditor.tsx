import type { HTMLAttributes } from 'react'
import { DragGhost } from './DragGhost'
import { MasonryGrid } from './MasonryGrid'
import { DeviceIcon } from './homeIcons'
import { describe, type EditItem, type EditRoom, type EditView } from './homeModel'
import { sortByOrder } from './dragSort'
import { useDragSort } from './useDragSort'

/** Everything Edit mode can do, as plain callbacks, so the page owns the draft.
 *  Dragging hands over a whole new order; the small ◀ ▶ buttons move one step, so a
 *  D-pad, a keyboard and a screen reader can arrange things too. */
export interface EditHandlers {
  moveRoom: (key: string, delta: -1 | 1) => void
  setRoomOrder: (keys: string[]) => void
  toggleRoom: (key: string) => void
  toggleWide: (key: string) => void
  moveDevice: (roomKey: string, id: string, delta: -1 | 1) => void
  setDeviceOrder: (roomKey: string, ids: string[]) => void
  toggleDevice: (id: string) => void
  moveScene: (id: string, delta: -1 | 1) => void
  setSceneOrder: (ids: string[]) => void
}

type DragProps = HTMLAttributes<HTMLElement> & { 'data-drag-group'?: string; 'data-drag-id'?: string }

/** The handle: drag it with a finger or a mouse. It is decoration for sighted users (the
 *  ◀ ▶ buttons are the accessible way), so it is hidden from screen readers. */
function Grip({ label }: { label: string }) {
  return (
    <span className="home-edit__grip" data-drag-grip="" aria-hidden="true" title={`Drag to move ${label}`}>
      ⠿
    </span>
  )
}

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
    <span className="home-edit__arrows">
      <button type="button" className="home-edit__arrow" aria-label={`Move ${name} earlier`} disabled={first} onClick={() => onMove(-1)}>
        ◀
      </button>
      <button type="button" className="home-edit__arrow" aria-label={`Move ${name} later`} disabled={last} onClick={() => onMove(1)}>
        ▶
      </button>
    </span>
  )
}

function EditTile({
  item,
  first,
  last,
  onMove,
  onToggle,
  drag,
  state,
}: {
  item: EditItem
  first: boolean
  last: boolean
  onMove: (delta: -1 | 1) => void
  onToggle: () => void
  /** Absent on the floating copy. */
  drag?: DragProps
  state?: 'source' | 'ghost'
}) {
  const { entity } = item
  return (
    <div
      className="home-tile home-tile--edit home-draggable"
      data-hidden={item.hidden}
      data-drag-state={state}
      {...drag}
    >
      <div className="home-tile__main home-tile__main--edit">
        <span className="home-tile__icon"><DeviceIcon entity={entity} /></span>
        <span className="home-tile__name" title={entity.name}>{entity.name}</span>
        <span className="home-tile__state">{item.hidden ? 'Hidden' : describe(entity)}</span>
      </div>
      <Grip label={entity.name} />
      <div className="home-edit__tools">
        <Arrows name={entity.name} first={first} last={last} onMove={onMove} />
        <button
          type="button"
          className="home-edit__chip"
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
  on,
  drag,
  state,
}: {
  room: EditRoom
  index: number
  count: number
  on: EditHandlers
  /** Absent on the floating copy. */
  drag?: DragProps
  state?: 'source' | 'ghost'
}) {
  const ids = room.items.map((i) => i.entity.entity_id)
  const sort = useDragSort({
    group: `devices:${room.key}`,
    ids,
    onCommit: (next) => on.setDeviceOrder(room.key, next),
    disabled: state === 'ghost',
  })
  const items = sortByOrder(room.items, (i) => i.entity.entity_id, sort.order)
  const ghostItem = sort.ghost ? room.items.find((i) => i.entity.entity_id === sort.ghost?.id) : null
  return (
    <section
      className={`home-room home-room--edit home-draggable${room.wide ? ' home-room--wide' : ''}`}
      data-hidden={room.hidden}
      data-drag-state={state}
      aria-label={room.name}
      {...drag}
    >
      <header className="home-room__head">
        <Grip label={room.name} />
        <h2 className="home-room__title">{room.name}</h2>
        {room.hidden && <span className="home-room__sum">Hidden</span>}
      </header>
      <div className="home-edit__tools home-edit__tools--room">
        <button
          type="button"
          className="home-edit__chip"
          aria-pressed={room.wide}
          aria-label={`${room.name} wide`}
          onClick={() => on.toggleWide(room.key)}
        >
          {room.wide ? 'Wide ✓' : 'Wide'}
        </button>
        <button
          type="button"
          className="home-edit__chip"
          aria-pressed={room.hidden}
          aria-label={`${room.hidden ? 'Show' : 'Hide'} ${room.name} room`}
          onClick={() => on.toggleRoom(room.key)}
        >
          {room.hidden ? 'Show room' : 'Hide room'}
        </button>
        <Arrows name={room.name} first={index === 0} last={index === count - 1} onMove={(d) => on.moveRoom(room.key, d)} />
      </div>
      <div className="home-room__tiles">
        {items.map((item) => {
          const id = item.entity.entity_id
          const i = ids.indexOf(id)
          return (
            <EditTile
              key={id}
              item={item}
              first={i === 0}
              last={i === ids.length - 1}
              onMove={(d) => on.moveDevice(room.key, id, d)}
              onToggle={() => on.toggleDevice(id)}
              drag={state === 'ghost' ? undefined : sort.itemProps(id)}
              state={sort.dragId === id ? 'source' : undefined}
            />
          )
        })}
      </div>
      <DragGhost ghost={sort.ghost} ghostRef={sort.ghostRef}>
        {ghostItem && <EditTile item={ghostItem} first={false} last={false} onMove={() => {}} onToggle={() => {}} state="ghost" />}
      </DragGhost>
    </section>
  )
}

/** The page body while arranging: scene chips, then every room with its controls. */
export function HomeEditor({ view, on }: { view: EditView; on: EditHandlers }) {
  const sceneIds = view.scenes.map((s) => s.entity.entity_id)
  const roomKeys = view.rooms.map((r) => r.key)
  const scenes = useDragSort({ group: 'scenes', ids: sceneIds, onCommit: on.setSceneOrder })
  const rooms = useDragSort({ group: 'rooms', ids: roomKeys, onCommit: on.setRoomOrder })

  const orderedScenes = sortByOrder(view.scenes, (s) => s.entity.entity_id, scenes.order)
  const orderedRooms = sortByOrder(view.rooms, (r) => r.key, rooms.order)
  const ghostScene = scenes.ghost ? view.scenes.find((s) => s.entity.entity_id === scenes.ghost?.id) : null
  const ghostRoom = rooms.ghost ? view.rooms.find((r) => r.key === rooms.ghost?.id) : null

  const chip = (item: EditItem, drag?: DragProps, state?: 'source' | 'ghost') => {
    const id = item.entity.entity_id
    const i = sceneIds.indexOf(id)
    return (
      <div
        key={id}
        className="home-scene-edit home-draggable"
        data-hidden={item.hidden}
        data-drag-state={state}
        {...drag}
      >
        <Grip label={item.entity.name} />
        <span className="home-scene-edit__name">
          <DeviceIcon entity={item.entity} /> {item.entity.name}
          {item.hidden && <span className="home-scene-edit__flag"> · Hidden</span>}
        </span>
        <Arrows
          name={item.entity.name}
          first={i === 0}
          last={i === sceneIds.length - 1}
          onMove={(d) => on.moveScene(id, d)}
        />
        <button
          type="button"
          className="home-edit__chip"
          aria-pressed={item.hidden}
          aria-label={`${item.hidden ? 'Show' : 'Hide'} ${item.entity.name}`}
          onClick={() => on.toggleDevice(id)}
        >
          {item.hidden ? 'Show' : 'Hide'}
        </button>
      </div>
    )
  }

  return (
    <>
      {view.scenes.length > 0 && (
        <section className="home__scenes home__scenes--edit" aria-label="Scenes">
          {orderedScenes.map((item) =>
            chip(item, scenes.itemProps(item.entity.entity_id), scenes.dragId === item.entity.entity_id ? 'source' : undefined),
          )}
          <DragGhost ghost={scenes.ghost} ghostRef={scenes.ghostRef}>
            {ghostScene && chip(ghostScene, undefined, 'ghost')}
          </DragGhost>
        </section>
      )}
      <MasonryGrid
        entries={orderedRooms.map((room) => ({
          key: room.key,
          wide: room.wide,
          node: (
            <EditRoomCard
              room={room}
              index={roomKeys.indexOf(room.key)}
              count={roomKeys.length}
              on={on}
              drag={rooms.itemProps(room.key)}
              state={rooms.dragId === room.key ? 'source' : undefined}
            />
          ),
        }))}
      />
      <DragGhost ghost={rooms.ghost} ghostRef={rooms.ghostRef}>
        {ghostRoom && (
          <EditRoomCard
            room={ghostRoom}
            index={roomKeys.indexOf(ghostRoom.key)}
            count={roomKeys.length}
            on={on}
            state="ghost"
          />
        )}
      </DragGhost>
    </>
  )
}
