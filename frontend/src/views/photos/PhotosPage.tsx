import { useQuery } from '@tanstack/react-query'
import { api, authedUrl } from '../../api/client'
import type { Photo } from '../../api/types'
import { showScreensaver } from '../../components/AiryChrome'

/** The photo library, full-bleed tiles. Sleep on the rail is what starts the
 *  slideshow; this page is where you see what will come up. */
export function PhotosPage() {
  const { data: photos = [], isLoading } = useQuery({
    queryKey: ['photos'],
    queryFn: () => api.get<Photo[]>('/photos'),
  })

  return (
    <div className="photos">
      <header className="photos__bar">
        <h1 className="photos__title">Photos</h1>
        <button type="button" className="btn btn--primary" onClick={showScreensaver}>
          Play
        </button>
      </header>
      {isLoading && <p className="hint">Loading photos…</p>}
      {!isLoading && photos.length === 0 && (
        <p className="hint">
          No photos yet. Add some in Settings, under Screen, and they will fill this page and the
          sleep slideshow.
        </p>
      )}
      <div className="photos__grid">
        {photos.map((photo) => (
          <figure key={photo.id} className="photos__tile">
            <img src={authedUrl(photo.url)} alt={photo.original_name ?? ''} />
          </figure>
        ))}
      </div>
    </div>
  )
}
