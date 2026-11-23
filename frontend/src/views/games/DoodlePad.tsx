import { useCallback, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { SendDoodlePicker } from '../messages/SendDoodlePicker'
import { DoodleSurface, type DoodleSurfaceHandle } from './DoodleSurface'

export function DoodlePad() {
  const [params] = useSearchParams()
  const replyTo = Number(params.get('replyTo') || '') || undefined
  const media = params.get('media') || undefined
  const surfaceRef = useRef<DoodleSurfaceHandle>(null)
  const [empty, setEmpty] = useState(true)
  const [png, setPng] = useState<string | null>(null)
  const onEmptyChange = useCallback((value: boolean) => setEmpty(value), [])

  function openPicker() {
    const data = surfaceRef.current?.exportPng() ?? ''
    if (!data) return
    setPng(data)
  }

  return (
    <div className="doodle-page">
      <DoodleSurface
        ref={surfaceRef}
        backgroundSrc={media}
        onEmptyChange={onEmptyChange}
        extraTools={
          <button type="button" className="doodle__action doodle__action--send" disabled={empty} onClick={openPicker}>
            Send to…
          </button>
        }
      />
      {png && (
        <SendDoodlePicker
          png={png}
          initialSelected={replyTo ? [replyTo] : []}
          onBack={() => setPng(null)}
        />
      )}
    </div>
  )
}
