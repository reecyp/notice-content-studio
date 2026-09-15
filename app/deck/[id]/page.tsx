import Link from 'next/link';
import DeckViewer from '@/components/DeckViewer';
import { loadDeck } from '@/lib/decks';

// Decks are read off disk on every request, so editing a JSON file and
// reloading is the whole authoring loop. Never prerender them.
export const dynamic = 'force-dynamic';

export default async function DeckPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const loaded = await loadDeck(id);

  return (
    <main className="wrap">
      <div className="masthead">
        <Link className="back" href="/">
          ← Library
        </Link>
        <h1>{id}</h1>
      </div>

      {'deck' in loaded ? (
        <DeckViewer deck={loaded.deck} />
      ) : (
        <div className="err">
          <h2>This deck did not load</h2>
          <pre>{loaded.error}</pre>
        </div>
      )}
    </main>
  );
}
