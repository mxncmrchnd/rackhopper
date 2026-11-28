import './style.css'
import {
  applyStaticTranslations,
  detectLanguage,
  getLanguage,
  onLanguageChange,
  setLanguage,
  t,
  tDynamic,
  type Language,
  type MessageKey,
} from './i18n.ts'
import { Adsr } from './modules/adsr.ts'
import { Filter } from './modules/filter.ts'
import { Output } from './modules/output.ts'
import {
  isModuleType,
  MODULE_TYPES,
  moduleInfo,
  type ModuleType,
} from './modules/registry.ts'
import { LOOP_BEATS, Sequencer } from './modules/sequencer.ts'
import type { SynthModule } from './modules/synth-module.ts'
import { Vca } from './modules/vca.ts'
import { Vco } from './modules/vco.ts'
import { defaultMelody } from './notes.ts'
import { Patch } from './patch.ts'
import {
  parseProject,
  ProjectError,
  projectFromHash,
  projectToHash,
  serializeProject,
  type SavedModule,
  type SavedProject,
} from './project.ts'
import type { ControlStyle } from './ui/controls.ts'
import { mustFind } from './ui/dom.ts'
import { PianoRoll } from './ui/piano-roll.ts'
import { RackView } from './ui/rack.ts'
import { ICONS, SegmentedToggle } from './ui/toggle.ts'

// Default patch: a simple pluck, laid out on two rows of the rack grid:
//
//   [Sequencer] [VCO] [Filter] [VCA]  [Output]
//                              [ADSR]
//
//   Sequencer pitch -> VCO pitch   (gates go to every ADSR, see onGate)
//   VCO -> Filter -> VCA -> Output
//   ADSR -> VCA gain and Filter cutoff
//
// What makes it a pluck: the envelope has a near-instant attack, a short decay
// and no sustain, so each note is a quick "pling" that dies away on its own.
// The same envelope also sweeps the filter's cutoff, so the note starts bright
// and gets duller as it fades, like a plucked string.

const playButton = mustFind<HTMLButtonElement>('#play')
const clearButton = mustFind<HTMLButtonElement>('#clear')
const voicesSelect = mustFind<HTMLSelectElement>('#voices')
const addModuleSelect = mustFind<HTMLSelectElement>('#add-module')
const togglesElement = mustFind<HTMLElement>('#toggles')
const newButton = mustFind<HTMLButtonElement>('#new-project')
const openButton = mustFind<HTMLButtonElement>('#open-project')
const fileInput = mustFind<HTMLInputElement>('#project-file')
const saveButton = mustFind<HTMLButtonElement>('#save-project')
const shareButton = mustFind<HTMLButtonElement>('#share-project')
const statusElement = mustFind<HTMLElement>('#status')
const rackElement = mustFind<HTMLElement>('#rack')
const pianoRollCanvas = mustFind<HTMLCanvasElement>('#piano-roll')

// The melody is shared by the sequencer and the piano roll.
const notes = defaultMelody()

// Autoplay policy: a page may *create* an AudioContext at any time, but it
// starts "suspended" (silent) until it's resumed from a user gesture. So we
// build everything at load, which lets the rack and piano roll show up right
// away, and resume on the first click or key press anywhere on the page.
// (Firefox logs a console warning about the suspended context: that's expected.)
const ctx = new AudioContext()
const resumeAudio = (): void => void ctx.resume()
// `{ once: true }` removes each listener after it has run one time.
document.addEventListener('pointerdown', resumeAudio, { once: true })
document.addEventListener('keydown', resumeAudio, { once: true })

const patch = new Patch()

/** Every ADSR in the patch. */
function envelopes(): Adsr[] {
  // TypeScript infers that this arrow function is a *type predicate*
  // ("returns true only for Adsr"), so filter() returns Adsr[], not SynthModule[].
  return patch.modules.filter((m) => m instanceof Adsr)
}

/** The sequencer, if there is one in the rack (`find` returns undefined otherwise). */
function currentSequencer(): Sequencer | undefined {
  return patch.modules.find((m) => m instanceof Sequencer)
}

/** Hook a newly created module up to the rest of the app. */
function prepare(module: SynthModule): void {
  if (module instanceof Sequencer) {
    // Sequencer gates go to every ADSR in the patch, looked up at each gate so
    // ADSRs added later get them too.
    module.onGate = (voice, on, time, velocity) => {
      for (const env of envelopes()) {
        if (on) env.gateOn(voice, time, velocity)
        else env.gateOff(voice, time)
      }
    }
  }
}

function buildDefaultPatch(): void {
  // patch.add returns the module with its own type (Vco, Filter, ...), so the
  // connect calls below are checked against each module's real port names.
  const sequencer = patch.add(new Sequencer(ctx, notes), { col: 0, row: 0 })
  const vco = patch.add(new Vco(ctx), { col: 1, row: 0 }) // 220 Hz = A3 = pitch CV 0
  const filter = patch.add(new Filter(ctx), { col: 2, row: 0 })
  const vca = patch.add(new Vca(ctx), { col: 3, row: 0 })
  const output = patch.add(new Output(ctx), { col: 4, row: 0 })
  const adsr = patch.add(new Adsr(ctx), { col: 3, row: 1 })
  prepare(sequencer)

  // Knob settings, by control id (the same helper that applies saved projects).
  applyControls(adsr, { attack: 0.002, decay: 0.35, sustain: 0, release: 0.3 })
  // Dark at rest (300 Hz); a full envelope opens it 4 octaves (to ~4.8 kHz).
  applyControls(filter, { cutoff: 300, resonance: 2, mod: 4 })

  patch.connect(sequencer, 'pitch', vco, 'pitch')
  patch.connect(vco, 'out', filter, 'in')
  patch.connect(filter, 'out', vca, 'in')
  patch.connect(vca, 'out', output, 'in')
  patch.connect(adsr, 'out', vca, 'gain')
  patch.connect(adsr, 'out', filter, 'cutoff')
}

buildDefaultPatch()
console.log('patch:', patch.toJSON())

// --- Preferences: controls, theme, language ---------------------------------------
//
// Each is remembered in localStorage. Storage can be unavailable (private
// windows, blocked site data) and then it throws, hence the try/catch helpers.

function loadPreference(key: string): string | null {
  try {
    return localStorage.getItem(`rackhopper.${key}`)
  } catch {
    return null
  }
}

function savePreference(key: string, value: string): void {
  try {
    localStorage.setItem(`rackhopper.${key}`, value)
  } catch {
    // Not remembered, but still applied for this visit.
  }
}

type Theme = 'dark' | 'light'

/** The theme in effect: the saved choice, else what the system prefers. */
function initialTheme(): Theme {
  const saved = loadPreference('theme')
  if (saved === 'dark' || saved === 'light') return saved
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

function applyTheme(theme: Theme): void {
  // CSS picks the palette from this attribute (see style.css).
  document.documentElement.dataset.theme = theme
}

const savedLanguage = loadPreference('language')
setLanguage(savedLanguage === 'fr' || savedLanguage === 'en' ? savedLanguage : detectLanguage())
applyStaticTranslations()

const controlStyle: ControlStyle = loadPreference('controls') === 'slider' ? 'slider' : 'knob'
const rack = new RackView(rackElement, patch, controlStyle)

// The three segmented toggles. Each one's type parameter is inferred from its
// options: the theme toggle is a SegmentedToggle<Theme>, and so on.
const controlsToggle = new SegmentedToggle<ControlStyle>(
  [
    { value: 'slider', label: () => t('toggle.sliders'), content: ICONS.slider, icon: true },
    { value: 'knob', label: () => t('toggle.knobs'), content: ICONS.knob, icon: true },
  ],
  controlStyle,
  () => t('toggle.controls'),
  (style) => {
    savePreference('controls', style)
    rack.setControlStyle(style)
  },
)

const themeToggle = new SegmentedToggle<Theme>(
  [
    { value: 'dark', label: () => t('toggle.dark'), content: ICONS.moon, icon: true },
    { value: 'light', label: () => t('toggle.light'), content: ICONS.sun, icon: true },
  ],
  initialTheme(),
  () => t('toggle.theme'),
  (theme) => {
    savePreference('theme', theme)
    applyTheme(theme)
  },
)

const languageToggle = new SegmentedToggle<Language>(
  [
    { value: 'fr', label: () => 'Français', content: 'FR' },
    { value: 'en', label: () => 'English', content: 'EN' },
  ],
  getLanguage(),
  () => t('toggle.language'),
  (language) => {
    savePreference('language', language)
    setLanguage(language) // runs the onLanguageChange listener below
  },
)

togglesElement.append(controlsToggle.element, themeToggle.element, languageToggle.element)
showPlaying(false) // the Play button's text is set from code, so set it once in the right language

// Everything that shows text, redrawn when the language changes.
onLanguageChange(() => {
  applyStaticTranslations()
  rack.refresh()
  refreshAddMenu()
  showPlaying(currentSequencer()?.playing ?? false)
  for (const toggle of [controlsToggle, themeToggle, languageToggle]) toggle.refresh()
})

// --- Adding and removing modules ------------------------------------------------

// Fill the "Add module" menu from the registry. `Object.entries` loses the key
// type (it returns [string, ...] pairs), hence the isModuleType check on change.
for (const type of Object.keys(MODULE_TYPES)) {
  addModuleSelect.append(new Option('', type)) // text is filled in by refreshAddMenu
}

/**
 * Update the "Add module" menu: translated names, and greyed-out entries for
 * what can't be added (singletons already in the rack, or everything if it's full).
 */
function refreshAddMenu(): void {
  const full = patch.firstFreeSlot() === null
  addModuleSelect.disabled = full
  for (const option of addModuleSelect.options) {
    if (!isModuleType(option.value)) continue // the "Add module…" placeholder
    const info = moduleInfo(option.value)
    option.textContent = tDynamic(`module.${option.value}`, info.title)
    option.disabled = info.singleton === true && patch.modules.some((m) => m.type === option.value)
  }

  // Sort by the displayed (translated) name, so the order follows the language.
  // localeCompare sorts like a dictionary would ("Écho" with the E's, not after Z).
  const [placeholder, ...modules] = addModuleSelect.options
  modules.sort((a, b) => a.text.localeCompare(b.text, getLanguage()))
  addModuleSelect.replaceChildren(placeholder, ...modules)
}
refreshAddMenu()

function addModule(type: ModuleType): void {
  const slot = patch.firstFreeSlot()
  if (!slot) return
  const module = MODULE_TYPES[type].create({ ctx, notes })
  prepare(module)
  patch.add(module, slot)
  rack.addPanel(module)
  refreshAddMenu()
  console.log('patch:', patch.toJSON())
}

addModuleSelect.addEventListener('change', () => {
  const type = addModuleSelect.value
  if (isModuleType(type)) addModule(type) // narrows `type` from string to ModuleType
  addModuleSelect.value = '' // back to the placeholder
})

rack.onModuleRemoved = (module) => {
  if (module instanceof Sequencer) showPlaying(false)
  refreshAddMenu()
}

// --- Piano roll and transport ---------------------------------------------------

new PianoRoll(pianoRollCanvas, notes, {
  loopBeats: LOOP_BEATS,
  // `?.` and `??`: no sequencer -> undefined -> null (no playhead).
  playhead: () => currentSequencer()?.currentBeat() ?? null,
})

function showPlaying(playing: boolean): void {
  playButton.textContent = t(playing ? 'transport.stop' : 'transport.play')
  playButton.setAttribute('aria-pressed', String(playing))
}

playButton.addEventListener('click', async () => {
  const sequencer = currentSequencer()
  if (!sequencer) return
  await ctx.resume()
  if (sequencer.playing) sequencer.stop()
  else sequencer.start()
  showPlaying(sequencer.playing)
})

/**
 * Make a button ask for a second click within 3 seconds before running
 * `action`, for things that can't be undone (Clear, New).
 */
function confirmOnSecondClick(
  button: HTMLButtonElement,
  normalKey: MessageKey,
  confirmKey: MessageKey,
  action: () => void,
): void {
  let timer: number | null = null
  const reset = (): void => {
    if (timer !== null) window.clearTimeout(timer)
    timer = null
    button.textContent = t(normalKey)
    button.classList.remove('confirming')
  }
  button.addEventListener('click', () => {
    if (timer === null) {
      button.textContent = t(confirmKey)
      button.classList.add('confirming')
      timer = window.setTimeout(reset, 3000)
      return
    }
    reset()
    action()
  })
}

confirmOnSecondClick(clearButton, 'transport.clear', 'transport.clearConfirm', () => {
  // splice(0) empties the array *in place*: the sequencer and piano roll hold
  // this same array, so `notes = []` (a new array) wouldn't reach them.
  // Sounding notes are released by the sequencer on its next tick.
  notes.splice(0)
})

voicesSelect.addEventListener('change', () => {
  patch.setVoices(Number(voicesSelect.value))
  console.log('patch:', patch.toJSON())
})

// --- Save and load ---------------------------------------------------------------

const AUTOSAVE_KEY = 'rackhopper.project'

/** A short message in the top bar, e.g. "Link copied". Errors show in red. */
let statusTimer: number | undefined
function showStatus(message: string, isError = false): void {
  statusElement.textContent = message
  statusElement.classList.toggle('error', isError)
  window.clearTimeout(statusTimer)
  statusTimer = window.setTimeout(() => (statusElement.textContent = ''), isError ? 8000 : 3000)
}

/** Show the voice count in the menu (adding an option if a file asked for an unusual count). */
function showVoices(count: number): void {
  const value = String(count)
  if (![...voicesSelect.options].some((o) => o.value === value)) {
    voicesSelect.append(new Option(value, value))
  }
  voicesSelect.value = value
}

/** Empty the rack (stopping the sequencer if it's playing). */
function clearRack(): void {
  for (const module of patch.modules) patch.remove(module.id)
  showPlaying(false)
}

/** Set a module's controls from saved values, ignoring anything that doesn't fit. */
function applyControls(module: SynthModule, values: SavedModule['controls']): void {
  // `SavedModule['controls']` is an indexed access type: "the type of the
  // controls property of SavedModule", i.e. Record<string, ControlValue>.
  for (const control of module.controls) {
    const value = values[control.id]
    if (control.kind === 'slider' && typeof value === 'number') {
      control.set(Math.min(control.max, Math.max(control.min, value)))
    } else if (control.kind === 'select' && typeof value === 'string' && control.options.includes(value)) {
      control.set(value)
    }
  }
}

/** Replace the current project with a saved one. */
function loadProject(project: SavedProject): void {
  clearRack()
  patch.setVoices(project.voices)
  showVoices(project.voices)

  // Saved id -> id of the module built for it, to remap connections.
  const newIds = new Map<string, string>()
  for (const saved of project.modules) {
    if (!isModuleType(saved.type)) {
      console.warn(`Skipping unknown module type "${saved.type}"`)
      continue
    }
    const info = moduleInfo(saved.type)
    if (info.singleton && patch.modules.some((m) => m.type === saved.type)) continue
    // Use the saved slot if it's free, otherwise the first free one.
    const slot = patch.isFree(saved) ? { col: saved.col, row: saved.row } : patch.firstFreeSlot()
    if (!slot) break // rack full
    const module = info.create({ ctx, notes })
    prepare(module)
    patch.add(module, slot)
    applyControls(module, saved.controls)
    newIds.set(saved.id, module.id)
  }

  for (const c of project.connections) {
    const from = newIds.get(c.from.moduleId)
    const to = newIds.get(c.to.moduleId)
    if (!from || !to) continue // one end was a skipped module
    try {
      patch.connectRefs({ moduleId: from, port: c.from.port }, { moduleId: to, port: c.to.port })
    } catch (error) {
      console.warn('Skipping connection', c, error) // e.g. a port that doesn't exist
    }
  }

  // Replace the notes in place (the sequencer and piano roll share this array).
  notes.splice(0, notes.length, ...project.notes)
  rack.refresh()
  refreshAddMenu()
  console.log('patch:', patch.toJSON())
}

function currentProject(): SavedProject {
  return serializeProject(patch, notes)
}

// Autosave: every second, store the project in localStorage if it changed.
// Comparing JSON strings is a simple way to notice any change at all (knobs,
// cables, notes...) without hooking every single edit.
let lastAutosave = ''
function autosave(): void {
  const json = JSON.stringify(currentProject())
  if (json === lastAutosave) return
  try {
    localStorage.setItem(AUTOSAVE_KEY, json)
    lastAutosave = json
  } catch {
    // Storage unavailable or full: nothing we can do, the session still works.
  }
}

function loadAutosave(): SavedProject | null {
  try {
    const json = localStorage.getItem(AUTOSAVE_KEY)
    return json === null ? null : parseProject(JSON.parse(json))
  } catch (error) {
    console.warn('Ignoring unreadable autosave', error)
    return null
  }
}

/** Load the project from a share link in the URL, if there is one. */
async function loadFromHash(): Promise<boolean> {
  try {
    const project = await projectFromHash(location.hash)
    if (!project) return false
    loadProject(project)
    showStatus(t('status.openedShared'))
    return true
  } catch (error) {
    showStatus(error instanceof ProjectError ? error.translated() : t('status.badLink'), true)
    return false
  } finally {
    // Drop the hash from the address bar: from now on the project lives in
    // autosave, and a reload shouldn't throw away edits made since opening it.
    // `finally` runs whether the try block returned, or threw.
    history.replaceState(null, '', location.pathname + location.search)
  }
}

confirmOnSecondClick(newButton, 'project.new', 'project.newConfirm', () => {
  clearRack()
  patch.setVoices(1)
  showVoices(1)
  buildDefaultPatch()
  notes.splice(0, notes.length, ...defaultMelody())
  rack.refresh()
  refreshAddMenu()
})

saveButton.addEventListener('click', () => {
  // A download is a temporary link to a Blob (an in-memory file), clicked from code.
  const blob = new Blob([JSON.stringify(currentProject(), null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = 'rackhopper-project.json'
  link.click()
  // Give the browser a moment to start the download before freeing the Blob.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
})

// "Open" clicks a hidden <input type="file">, which shows the file picker.
openButton.addEventListener('click', () => fileInput.click())
fileInput.addEventListener('change', async () => {
  const file = fileInput.files?.[0]
  fileInput.value = '' // so choosing the same file again still fires `change`
  if (!file) return
  try {
    loadProject(parseProject(JSON.parse(await file.text())))
    showStatus(t('status.openedFile', { name: file.name }))
  } catch (error) {
    // JSON.parse throws a SyntaxError for files that aren't JSON at all.
    showStatus(
      error instanceof ProjectError ? error.translated() : t('status.invalidFile', { name: file.name }),
      true,
    )
  }
})

shareButton.addEventListener('click', async () => {
  const hash = await projectToHash(currentProject())
  const url = location.origin + location.pathname + hash
  try {
    await navigator.clipboard.writeText(url)
    showStatus(t('status.linkCopied'))
  } catch {
    // Clipboard blocked: put the link in the address bar to copy by hand.
    history.replaceState(null, '', hash)
    showStatus(t('status.copyFromBar'))
  }
})

// Pasting another share link into the address bar of an open tab only changes
// the hash (no page reload), so watch for that too.
window.addEventListener('hashchange', () => void loadFromHash())

// Startup: a share link wins, then the autosave, else the default patch (already built).
async function restore(): Promise<void> {
  const fromLink = await loadFromHash()
  if (!fromLink) {
    const saved = loadAutosave()
    if (saved) loadProject(saved)
  }
  lastAutosave = JSON.stringify(currentProject())
  window.setInterval(autosave, 1000)
  // Also save when the tab is hidden or closed, so the last second isn't lost.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') autosave()
  })
}
void restore()
