/**
 * Web application entry: thin bootstrap over the shell library. Everything —
 * module-table seeding, the boot page, and the UI-renderer handoff — lives
 * in @deepseek-ai/dsh-client-web; this file only finds the mount point.
 */
import { AppWebEntry } from '@deepseek-ai/dsh-client-web'
import { installDesktopChrome } from './desktop-chrome.ts'
import './desktop-chrome.css'

const el = document.getElementById('root')
if (el === null) throw new Error('web app: missing #root')
installDesktopChrome()
void new AppWebEntry(el).run()
