import { useState, type KeyboardEvent } from 'react'
import { Plus, X } from 'lucide-react'
import { MAX_TAGS, normalizeTag } from './tags'

interface TagInputProps {
  value: string[]
  onChange: (tags: string[]) => void
  suggestions: string[]
}

// Chips + campo de texto: Enter ou vírgula adiciona, Backspace com o campo
// vazio remove a última. Tags já usadas aparecem como atalho de 1 toque.
export function TagInput({ value, onChange, suggestions }: TagInputProps) {
  const [draft, setDraft] = useState('')
  const full = value.length >= MAX_TAGS

  function add(raw: string) {
    const tag = normalizeTag(raw)
    setDraft('')
    if (tag === '' || value.includes(tag) || full) return
    onChange([...value, tag])
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      add(draft)
    } else if (e.key === 'Backspace' && draft === '' && value.length > 0) {
      onChange(value.slice(0, -1))
    }
  }

  const visibleSuggestions = suggestions
    .filter((s) => !value.includes(s) && s.includes(normalizeTag(draft)))
    .slice(0, 6)

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor="tag-input" className="text-sm text-light-secondary dark:text-dark-secondary">
        Tags (opcional)
      </label>
      <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-border-light bg-surface-light px-3 py-2 focus-within:border-brand-500 dark:border-border-dark dark:bg-surface-dark-elevated">
        {value.map((tag) => (
          <span
            key={tag}
            className="flex items-center gap-1 rounded-full bg-brand-500/10 py-0.5 pl-2.5 pr-1 text-xs font-medium text-brand-500"
          >
            #{tag}
            <button
              type="button"
              aria-label={`Remover tag ${tag}`}
              onClick={() => onChange(value.filter((t) => t !== tag))}
              className="flex h-4 w-4 items-center justify-center rounded-full hover:bg-brand-500/20"
            >
              <X size={11} />
            </button>
          </span>
        ))}
        <input
          id="tag-input"
          value={draft}
          disabled={full}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={() => add(draft)}
          placeholder={full ? `Máximo de ${MAX_TAGS} tags` : value.length === 0 ? 'Ex: viagem, reforma' : ''}
          className="min-w-[6rem] flex-1 bg-transparent py-0.5 text-base text-light-primary outline-none placeholder:text-light-secondary dark:text-dark-primary dark:placeholder:text-dark-secondary"
        />
      </div>
      {!full && visibleSuggestions.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {visibleSuggestions.map((tag) => (
            <button
              key={tag}
              type="button"
              // onMouseDown em vez de onClick: o blur do input (que também
              // adiciona o rascunho) dispararia antes e engoliria o clique.
              onMouseDown={(e) => {
                e.preventDefault()
                add(tag)
              }}
              className="flex items-center gap-1 rounded-full border border-dashed border-border-light px-2.5 py-0.5 text-xs text-light-secondary transition-colors duration-200 hover:border-brand-500 hover:text-brand-500 dark:border-border-dark dark:text-dark-secondary"
            >
              <Plus size={11} />
              {tag}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
