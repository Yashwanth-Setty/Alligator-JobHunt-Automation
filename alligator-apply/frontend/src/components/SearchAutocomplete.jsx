import { useEffect, useRef, useState } from 'react';
import { Input } from './ui/input';
import { cn } from '@/lib/utils';

/**
 * Simple autocomplete: input + filtered dropdown. No chips.
 */
export default function SearchAutocomplete({
  value = '',
  onChange,
  disabled,
  placeholder,
  getSuggestions,
  minChars = 1,
}) {
  const [input, setInput] = useState(value);
  const [suggestions, setSuggestions] = useState([]);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const wrapRef = useRef(null);

  useEffect(() => {
    setInput(value);
  }, [value]);

  const refreshSuggestions = (text) => {
    const q = text.trim();
    if (q.length < minChars) {
      setSuggestions([]);
      setOpen(false);
      return;
    }
    const next = getSuggestions(q) || [];
    setSuggestions(next);
    setOpen(next.length > 0);
    setActiveIndex(-1);
  };

  const handleChange = (e) => {
    const next = e.target.value;
    setInput(next);
    onChange(next);
    refreshSuggestions(next);
  };

  const selectSuggestion = (label) => {
    setInput(label);
    onChange(label);
    setOpen(false);
    setSuggestions([]);
    setActiveIndex(-1);
  };

  const handleFocus = () => {
    refreshSuggestions(input);
  };

  const handleKeyDown = (e) => {
    if (!open || !suggestions.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && activeIndex >= 0) {
      e.preventDefault();
      selectSuggestion(suggestions[activeIndex]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  useEffect(() => {
    const onDocClick = (ev) => {
      if (wrapRef.current && !wrapRef.current.contains(ev.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const menuOpen = open && suggestions.length > 0;

  return (
    <div
      ref={wrapRef}
      className={cn('search-autocomplete-root', menuOpen && 'search-autocomplete-root--open')}
    >
      <Input
        value={input}
        onChange={handleChange}
        onFocus={handleFocus}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        autoComplete="off"
      />
      {menuOpen && (
        <ul className="search-autocomplete-menu" role="listbox">
          {suggestions.map((label, i) => (
            <li key={label} role="option" aria-selected={i === activeIndex}>
              <button
                type="button"
                className={cn(
                  'search-autocomplete-option',
                  i === activeIndex && 'search-autocomplete-option--active'
                )}
                onMouseDown={(e) => {
                  e.preventDefault();
                  selectSuggestion(label);
                }}
                onMouseEnter={() => setActiveIndex(i)}
              >
                {label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
