import { useState } from 'react';
import { searchPlaces } from './api.ts';
import type { PlaceResult } from './api.ts';

interface Props {
  /** Button text for each result, e.g. "Go here with everyone". */
  action: string;
  onPick: (place: PlaceResult) => void;
  onClose?: () => void;
}

/**
 * Search for a real place (malls, schools, apartments, parks…). It only searches when you
 * press Search — OpenStreetMap's search rules do not allow search-as-you-type.
 */
export function PlacesPanel({ action, onPick, onClose }: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PlaceResult[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const search = async (): Promise<void> => {
    if (query.trim().length < 3 || busy) return;
    setBusy(true);
    setError('');
    try {
      setResults(await searchPlaces(query));
    } catch (problem) {
      setError((problem as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel places" aria-label="Find a place">
      <header>
        <h2>Where to?</h2>
        {onClose && (
          <button type="button" className="close" onClick={onClose}>
            Close
          </button>
        )}
      </header>
      <form
        className="searchRow"
        onSubmit={(event) => {
          event.preventDefault();
          void search();
        }}
      >
        <input value={query} placeholder="e.g. VR Bengaluru, Cubbon Park, your school" onChange={(event) => setQuery(event.target.value)} />
        <button type="submit" disabled={busy || query.trim().length < 3}>
          {busy ? '…' : 'Search'}
        </button>
      </form>
      {error && <p className="errorText small">{error}</p>}
      {results && results.length === 0 && <p className="small">Nothing found. Try another name.</p>}
      {results && results.length > 0 && (
        <ul className="results">
          {results.map((place) => (
            <li key={`${place.lat},${place.lng}`}>
              <div>
                <strong>{place.name}</strong>
                <span>{place.detail}</span>
              </div>
              <button type="button" onClick={() => onPick(place)}>
                {action}
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="small credit">Search © OpenStreetMap contributors</p>
    </section>
  );
}
