import 'bootstrap/dist/css/bootstrap.min.css'
import './styles/app.css'
import './styles/exam-v2.css'
import { bootstrap } from './lib/bootstrap'
import { initTheme } from './lib/theme'
import { App } from './app/App'

initTheme()
bootstrap(<App />)
