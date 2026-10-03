import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { OAuthConsentPage } from './consent-page'
import '@/index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode><OAuthConsentPage /></StrictMode>,
)
