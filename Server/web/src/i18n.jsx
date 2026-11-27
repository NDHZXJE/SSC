// Đa ngôn ngữ đơn giản: chuỗi tiếng Việt trong code là khóa, en.js / ja.js là bản dịch.
// Chuỗi chưa có bản dịch thì hiện nguyên tiếng Việt. {x} trong chuỗi được thay bằng vars.x.
import { useSyncExternalStore } from 'react'
import en from './i18n/en.js'
import ja from './i18n/ja.js'

const DICT = { en, ja }
export const LANGS = [['vi', 'VI', 'Tiếng Việt'], ['en', 'EN', 'English'], ['ja', 'JA', '日本語']]
const LOCALE = { vi: 'vi-VN', en: 'en-US', ja: 'ja-JP' }

const pick = () => {
  try {
    const s = localStorage.getItem('ssc-lang')
    if (s && LOCALE[s]) return s
  } catch { /* trình duyệt chặn storage */ }
  const nav = (navigator.language || 'vi').slice(0, 2)
  return LOCALE[nav] ? nav : 'vi'
}

let lang = pick()
const subs = new Set()
document.documentElement.lang = lang

export function setLang(l) {
  if (!LOCALE[l] || l === lang) return
  lang = l
  try { localStorage.setItem('ssc-lang', l) } catch { /* bỏ qua */ }
  document.documentElement.lang = l
  subs.forEach(f => f())
}
export const getLang = () => lang
export const locale = () => LOCALE[lang]

// Dùng được cả ngoài component (đọc ngôn ngữ hiện tại lúc gọi)
export function t(s, vars) {
  let out = lang !== 'vi' && Object.hasOwn(DICT[lang], s) ? DICT[lang][s] : s
  if (vars) out = out.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m))
  return out
}

// Component gọi hook này để vẽ lại khi đổi ngôn ngữ
export function useLang() {
  useSyncExternalStore(f => { subs.add(f); return () => subs.delete(f) }, () => lang)
  return { lang, t, setLang, locale: LOCALE[lang] }
}

export function LangSwitch({ className = '' }) {
  const { lang: cur } = useLang()
  return (
    <div className={'lang-switch ' + className} role="group" aria-label="Language">
      {LANGS.map(([k, short, name]) => (
        <button key={k} type="button" className={cur === k ? 'on' : ''} title={name} aria-pressed={cur === k} onClick={() => setLang(k)}>{short}</button>
      ))}
    </div>
  )
}
