// Translations: every piece of UI text, in English and French.
//
// The English dictionary defines the keys. The French one is typed
// `Record<MessageKey, string>`, so the compiler refuses to build if a key is
// missing from it (or misspelled). Adding a string means adding it to both.
//
// Text can contain {placeholders}, filled in by t(): t('openedFile', { name }).
//
// Static text in index.html is marked with data-i18n attributes and filled in
// by applyStaticTranslations(). Code calls t() directly.

export type Language = 'en' | 'fr'

const en = {
  // Top bar
  'project.label': 'Project',
  'project.new': 'New',
  'project.newConfirm': 'Click again: new project',
  'project.open': 'Open…',
  'project.save': 'Save',
  'project.share': 'Share link',
  'toggle.controls': 'Control style',
  'toggle.sliders': 'Sliders',
  'toggle.knobs': 'Knobs',
  'toggle.theme': 'Theme',
  'toggle.dark': 'Dark theme',
  'toggle.light': 'Light theme',
  'toggle.language': 'Language',

  // Sequencer panel
  'sequencer.label': 'Sequencer',
  'transport.play': 'Play',
  'transport.stop': 'Stop',
  'transport.gate': 'Hold to play',
  'transport.clear': 'Clear',
  'transport.clearConfirm': 'Click again to clear',
  'transport.voices': 'Voices',
  'transport.mono': '1 (mono)',
  'pianoRoll.hint':
    'Click to add a note · drag to move · drag the right edge to resize · right-click (or click) a note to delete it',

  // Rack panel
  'rack.label': 'Rack',
  'rack.add': '+ Add module…',
  'rack.addLabel': 'Add module',
  'rack.hint': 'Drag a module by its title bar to move it · right-click a knob to type a value',
  'rack.remove': 'Remove {name}',
  'jack.input': 'Input: {port}',
  'jack.output': 'Output: {port}',
  'control.knobHint': 'Drag to turn · right-click to type a value · double-click to reset',
  'control.sliderHint': 'Right-click to type a value · double-click to reset',
  'control.valueOf': '{label} value',

  // Status messages
  'status.openedShared': 'Opened shared project',
  'status.openedFile': 'Opened {name}',
  'status.invalidFile': '{name} is not a valid project file.',
  'status.badLink': 'Could not open this link.',
  'status.linkCopied': 'Link copied to the clipboard',
  'status.copyFromBar': 'Copy the link from the address bar',

  // Project errors
  'error.notProject': 'This is not a rackhopper project.',
  'error.version': 'Unsupported project version: {version}.',
  'error.voices': 'The voice count must be a whole number from 1 to 8.',
  'error.missing': 'The project is missing its modules, connections or notes.',
  'error.module': 'A module entry is malformed.',
  'error.connection': 'A connection entry is malformed.',
  'error.note': 'A note entry is malformed.',
  'error.damagedLink': 'This link is damaged or incomplete.',

  // Module titles, by module type
  'module.sequencer': 'Sequencer',
  'module.vco': 'VCO',
  'module.lfo': 'LFO',
  'module.filter': 'Filter',
  'module.vca': 'VCA',
  'module.adsr': 'ADSR',
  'module.output': 'Output',

  // Control labels, by control id
  'control.wave': 'Wave',
  'control.frequency': 'Freq',
  'control.unison': 'Unison',
  'control.detune': 'Detune',
  'control.rate': 'Rate',
  'control.depth': 'Depth',
  'control.type': 'Type',
  'control.cutoff': 'Cutoff',
  'control.resonance': 'Reso',
  'control.mod': 'Mod',
  'control.level': 'Level',
  'control.attack': 'Attack',
  'control.decay': 'Decay',
  'control.sustain': 'Sustain',
  'control.release': 'Release',
  'control.volume': 'Volume',
  'control.tempo': 'Tempo',

  // Dropdown options, by value
  'option.sine': 'Sine',
  'option.triangle': 'Triangle',
  'option.sawtooth': 'Saw',
  'option.square': 'Square',
  'option.lowpass': 'Low-pass',
  'option.highpass': 'High-pass',
  'option.bandpass': 'Band-pass',
}

/** Every valid key: 'project.new' | 'project.open' | ... */
export type MessageKey = keyof typeof en

const fr: Record<MessageKey, string> = {
  'project.label': 'Projet',
  'project.new': 'Nouveau',
  'project.newConfirm': 'Cliquer à nouveau : nouveau projet',
  'project.open': 'Ouvrir…',
  'project.save': 'Enregistrer',
  'project.share': 'Partager le lien',
  'toggle.controls': 'Style des contrôles',
  'toggle.sliders': 'Curseurs',
  'toggle.knobs': 'Boutons rotatifs',
  'toggle.theme': 'Thème',
  'toggle.dark': 'Thème sombre',
  'toggle.light': 'Thème clair',
  'toggle.language': 'Langue',

  'sequencer.label': 'Séquenceur',
  'transport.play': 'Lecture',
  'transport.stop': 'Stop',
  'transport.gate': 'Maintenir pour jouer',
  'transport.clear': 'Effacer',
  'transport.clearConfirm': 'Cliquer à nouveau pour effacer',
  'transport.voices': 'Voix',
  'transport.mono': '1 (mono)',
  'pianoRoll.hint':
    'Cliquer pour ajouter une note · glisser pour la déplacer · glisser le bord droit pour la redimensionner · clic droit (ou clic) sur une note pour la supprimer',

  'rack.label': 'Rack',
  'rack.add': '+ Ajouter un module…',
  'rack.addLabel': 'Ajouter un module',
  'rack.hint':
    'Glisser un module par sa barre de titre pour le déplacer · clic droit sur un bouton pour saisir une valeur',
  'rack.remove': 'Retirer {name}',
  'jack.input': 'Entrée : {port}',
  'jack.output': 'Sortie : {port}',
  'control.knobHint':
    'Glisser pour tourner · clic droit pour saisir une valeur · double-clic pour réinitialiser',
  'control.sliderHint': 'Clic droit pour saisir une valeur · double-clic pour réinitialiser',
  'control.valueOf': 'Valeur de {label}',

  'status.openedShared': 'Projet partagé ouvert',
  'status.openedFile': '{name} ouvert',
  'status.invalidFile': "{name} n'est pas un fichier de projet valide.",
  'status.badLink': "Impossible d'ouvrir ce lien.",
  'status.linkCopied': 'Lien copié dans le presse-papiers',
  'status.copyFromBar': "Copiez le lien depuis la barre d'adresse",

  'error.notProject': "Ce n'est pas un projet rackhopper.",
  'error.version': 'Version de projet non prise en charge : {version}.',
  'error.voices': 'Le nombre de voix doit être un entier de 1 à 8.',
  'error.missing': 'Il manque les modules, les connexions ou les notes du projet.',
  'error.module': 'Une entrée de module est invalide.',
  'error.connection': 'Une entrée de connexion est invalide.',
  'error.note': 'Une entrée de note est invalide.',
  'error.damagedLink': 'Ce lien est endommagé ou incomplet.',

  'module.sequencer': 'Séquenceur',
  'module.vco': 'VCO',
  'module.lfo': 'LFO',
  'module.filter': 'Filtre',
  'module.vca': 'VCA',
  'module.adsr': 'ADSR',
  'module.output': 'Sortie',

  'control.wave': 'Onde',
  'control.frequency': 'Fréq',
  'control.unison': 'Unisson',
  'control.detune': 'Désacc.',
  'control.rate': 'Vitesse',
  'control.depth': 'Intensité',
  'control.type': 'Type',
  'control.cutoff': 'Coupure',
  'control.resonance': 'Réso',
  'control.mod': 'Mod',
  'control.level': 'Niveau',
  'control.attack': 'Attaque',
  'control.decay': 'Déclin',
  'control.sustain': 'Maintien',
  'control.release': 'Relâche',
  'control.volume': 'Volume',
  'control.tempo': 'Tempo',

  'option.sine': 'Sinus',
  'option.triangle': 'Triangle',
  'option.sawtooth': 'Scie',
  'option.square': 'Carré',
  'option.lowpass': 'Passe-bas',
  'option.highpass': 'Passe-haut',
  'option.bandpass': 'Passe-bande',
}

const dictionaries: Record<Language, Record<MessageKey, string>> = { en, fr }

let current: Language = 'en'
const listeners: (() => void)[] = []

export function getLanguage(): Language {
  return current
}

export function setLanguage(language: Language): void {
  current = language
  document.documentElement.lang = language
  for (const listener of listeners) listener()
}

/** Run `listener` every time the language changes. */
export function onLanguageChange(listener: () => void): void {
  listeners.push(listener)
}

type Params = Record<string, string | number>

function fill(text: string, params: Params = {}): string {
  // Replace each {name} with params.name (left as-is if not given).
  return text.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  )
}

/** Translate a key into the current language. */
export function t(key: MessageKey, params?: Params): string {
  return fill(dictionaries[current][key], params)
}

/** Translate a key into a given language (e.g. English for error messages in the console). */
export function tIn(language: Language, key: MessageKey, params?: Params): string {
  return fill(dictionaries[language][key], params)
}

/**
 * Translate a key built at runtime, like `module.${module.type}`, which
 * TypeScript can't check. Falls back to `fallback` if the key doesn't exist.
 */
export function tDynamic(key: string, fallback: string): string {
  // Widening to Partial<Record<string, string>> lets us index with any string,
  // and makes the result `string | undefined`, so we must handle "missing".
  const dictionary: Partial<Record<string, string>> = dictionaries[current]
  return dictionary[key] ?? fallback
}

/** The browser's preferred language, if we have it, else English. */
export function detectLanguage(): Language {
  return navigator.language.toLowerCase().startsWith('fr') ? 'fr' : 'en'
}

/**
 * Fill in static text in the page:
 *   data-i18n="key"        -> textContent
 *   data-i18n-label="key"  -> aria-label
 */
export function applyStaticTranslations(root: ParentNode = document): void {
  for (const element of root.querySelectorAll<HTMLElement>('[data-i18n]')) {
    const key = element.dataset.i18n
    if (key) element.textContent = tDynamic(key, element.textContent)
  }
  for (const element of root.querySelectorAll<HTMLElement>('[data-i18n-label]')) {
    const key = element.dataset.i18nLabel // data-i18n-label becomes dataset.i18nLabel
    if (key) element.setAttribute('aria-label', tDynamic(key, element.getAttribute('aria-label') ?? ''))
  }
}
