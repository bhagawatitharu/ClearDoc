import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { warmPdfWorker } from './documentReader.js'
import './index.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  const serviceWorkerUrl = new URL('sw.js', document.baseURI)
  const serviceWorkerScope = new URL('.', serviceWorkerUrl)

  if (!navigator.serviceWorker.controller) {
    navigator.serviceWorker.addEventListener(
      'controllerchange',
      () => window.location.reload(),
      { once: true },
    )
  }

  navigator.serviceWorker.register(serviceWorkerUrl, {
    scope: serviceWorkerScope.pathname,
  }).catch((error) => {
    console.error('ClearDoc could not enable offline app support:', error)
  })

  navigator.serviceWorker.ready.then(() => {
    if (navigator.serviceWorker.controller) warmPdfWorker()
  })
}
