import { QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Navigate, RouterProvider, createBrowserRouter } from 'react-router-dom'
import { queryClient } from './api/queryClient'
import { MealsPage, ShowOnTvPage } from './HouseholdDisplay'
import { App } from './App'
import './styles/global.css'
import './styles/calendar.css'
import './styles/settings.css'
import './styles/dashboard.css'
import './styles/screensaver.css'
import './styles/chores.css'
import '@fontsource/nunito/latin-400.css'
import '@fontsource/nunito/latin-600.css'
import '@fontsource/nunito/latin-700.css'
import '@fontsource/nunito/latin-800.css'
import '@fontsource/nunito/latin-ext-400.css'
import '@fontsource/nunito/latin-ext-600.css'
import '@fontsource/nunito/latin-ext-700.css'
import '@fontsource/nunito/latin-ext-800.css'
import { CalendarPage } from './views/calendar/CalendarPage'
import { ChoresPage } from './views/chores/ChoresPage'
import { DashboardPage } from './views/dashboard/DashboardPage'
import { ListsPage } from './views/lists/ListsPage'
import { PhotosPage } from './views/photos/PhotosPage'
import { SettingsPage } from './views/settings/SettingsPage'
import { hydrate, watchQueries } from './offline/persist'
import './styles/airy.css'
import './styles/tv.css'
import { installTvNavigation } from './tv/navigation'

installTvNavigation()

const router = createBrowserRouter([
  {
    path: '/',
    element: <App />,
    children: [
      // Opening the app with no route lands on today. A week is what you plan with;
      // a day is what you came to check.
      { index: true, element: <Navigate to="/calendar/today" replace /> },
      { path: 'calendar/:view', element: <CalendarPage /> },
      { path: 'dashboard', element: <DashboardPage /> },
      { path: 'meals', element: <MealsPage /> },
      { path: 'show-on-tv', element: <ShowOnTvPage /> },
      { path: 'lists', element: <ListsPage /> },
      { path: 'chores', element: <ChoresPage /> },
      { path: 'photos', element: <PhotosPage /> },
      { path: 'settings', element: <SettingsPage /> },
      // The API guide used to be its own page. Keep old bookmarks and kiosk
      // shortcuts working by sending them to the tab that replaced it.
      { path: 'docs', element: <Navigate to="/settings?tab=api" replace /> },
      { path: '*', element: <Navigate to="/calendar/today" replace /> },
    ],
  },
])

// Registered after load so the worker never competes with the first paint.
// The worker deliberately leaves /api/version alone -- see public/sw.js.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    // The version is in the URL so a new release registers a new worker, whose
    // activate step purges the previous release's caches.
    const v = encodeURIComponent(import.meta.env.VITE_APP_VERSION ?? 'dev')
    void navigator.serviceWorker.register(`/sw.js?v=${v}`)
  })
}

const root = createRoot(document.getElementById('root')!)
const tree = (
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>
)

// Draw the last schedule immediately, then keep writing successful fetches
// back. A slow or missing IndexedDB must not hold the first paint.
watchQueries(queryClient)
void Promise.race([
  hydrate(queryClient),
  new Promise((resolve) => window.setTimeout(resolve, 1500)),
]).finally(() => root.render(tree))
