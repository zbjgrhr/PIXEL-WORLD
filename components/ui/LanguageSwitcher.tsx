'use client'

import { useEffect, useState } from 'react'
import { englishUi, translateUiText, UI_LOCALE_KEY, type UiLocale } from '@/lib/ui-locale'

const originals = new WeakMap<Text, string>()
const attributeOriginals = new WeakMap<Element, Map<string, string>>()
const attributes = ['placeholder', 'aria-label', 'title', 'alt'] as const
const reverse = new Map(Object.entries(englishUi).map(([zh, en]) => [en, zh]))

function applyLocale(root: Node, locale: UiLocale) {
  const translateText = (node: Text) => {
    if (node.parentElement?.closest('script,style,textarea,code,pre,[contenteditable="true"],[data-no-ui-translation]')) return
    const current = node.nodeValue || ''
    const trimmed = current.trim()
    if (!trimmed) return
    const prior = originals.get(node)
    if (locale === 'zh-CN') {
      if (prior !== undefined && current === translateUiText(prior)) node.nodeValue = prior
      return
    }
    if (prior !== undefined && current === translateUiText(prior)) return
    const source = reverse.get(trimmed) || trimmed
    const translated = translateUiText(source)
    if (!translated) return
    originals.set(node, current)
    node.nodeValue = current.replace(trimmed, translated)
  }
  const translateElement = (element: Element) => {
    if (element.closest('[data-no-ui-translation]')) return
    for (const name of attributes) {
      const current = element.getAttribute(name)
      if (!current) continue
      const records = attributeOriginals.get(element) || new Map<string, string>()
      const prior = records.get(name)
      if (locale === 'zh-CN') {
        if (prior && current === translateUiText(prior)) element.setAttribute(name, prior)
        continue
      }
      if (prior && current === translateUiText(prior)) continue
      const translated = translateUiText(current)
      if (!translated) continue
      records.set(name, current)
      attributeOriginals.set(element, records)
      element.setAttribute(name, translated)
    }
  }
  if (root.nodeType === Node.TEXT_NODE) translateText(root as Text)
  if (root.nodeType === Node.ELEMENT_NODE) translateElement(root as Element)
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT)
  while (walker.nextNode()) {
    if (walker.currentNode.nodeType === Node.TEXT_NODE) translateText(walker.currentNode as Text)
    else translateElement(walker.currentNode as Element)
  }
}

export function useUiLocale() {
  const [locale, setLocale] = useState<UiLocale>('zh-CN')
  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get('lang')
    if (requested === 'en' || requested === 'zh-CN') localStorage.setItem(UI_LOCALE_KEY, requested)
    const saved = localStorage.getItem(UI_LOCALE_KEY)
    if (saved === 'en') setLocale('en')
    const sync = () => setLocale(localStorage.getItem(UI_LOCALE_KEY) === 'en' ? 'en' : 'zh-CN')
    window.addEventListener('pixel-world-locale-change', sync)
    return () => window.removeEventListener('pixel-world-locale-change', sync)
  }, [])
  return locale
}

export default function LanguageSwitcher({ placement = 'header' }: { placement?: 'header' | 'floating' }) {
  const locale = useUiLocale()
  useEffect(() => {
    if (placement !== 'header') return
    document.documentElement.lang = locale
    applyLocale(document.body, locale)
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'characterData') applyLocale(mutation.target, locale)
        if (mutation.type === 'attributes') applyLocale(mutation.target, locale)
        for (const node of mutation.addedNodes) applyLocale(node, locale)
      }
    })
    observer.observe(document.body, { childList: true, characterData: true, attributes: true, attributeFilter: [...attributes], subtree: true })
    return () => observer.disconnect()
  }, [locale, placement])
  const choose = (next: UiLocale) => {
    localStorage.setItem(UI_LOCALE_KEY, next)
    window.dispatchEvent(new Event('pixel-world-locale-change'))
  }
  return <div className={`language-switcher language-switcher-${placement}`} role="group" aria-label="Interface language">
    <button type="button" aria-pressed={locale === 'zh-CN'} onClick={() => choose('zh-CN')}>中文</button>
    <button type="button" aria-pressed={locale === 'en'} onClick={() => choose('en')}>EN</button>
  </div>
}
