import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import App from './App'
import { boot } from './store'
import './styles.css'

registerSW({ immediate: true })
void boot()
createRoot(document.getElementById('root')!).render(<App />)
