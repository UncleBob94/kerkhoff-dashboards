// Runs server-side (GitHub Actions). Queries Notion for weekly goals and
// writes a small static JSON file the dashboard page reads.
// Requires NOTION_TOKEN as an environment variable (set via GitHub Secret) —
// never hardcode it here.

const DATABASE_ID = '95e1f335-27b3-4c2f-80d0-86d8336f12d9';
const OUTPUT_PATH = 'goals-data.json';

const NOTION_TOKEN = process.env.NOTION_TOKEN;

if (!NOTION_TOKEN) {
  console.error('Missing NOTION_TOKEN environment variable.');
  process.exit(1);
}

async function fetchAllGoals() {
  let results = [];
  let cursor;

  do {
    const body = { page_size: 100 };
    if (cursor) body.start_cursor = cursor;

    const res = await fetch(`https://api.notion.com/v1/databases/${DATABASE_ID}/query`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${NOTION_TOKEN}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Notion API error ${res.status}: ${errText}`);
    }

    const data = await res.json();
    results = results.concat(data.results);
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);

  return results;
}

function simplify(pages) {
  return pages
    .map(page => {
      const status = page.properties['Status']?.select?.name || null;
      const weekOf = page.properties['Week Of']?.date?.start || null;
      return weekOf ? { status, weekOf } : null;
    })
    .filter(Boolean);
}

(async () => {
  try {
    const pages = await fetchAllGoals();
    const simplified = simplify(pages);

    const output = {
      generated_at: new Date().toISOString(),
      records: simplified
    };

    const fs = await import('node:fs/promises');
    await fs.writeFile(OUTPUT_PATH, JSON.stringify(output, null, 2));
    console.log(`Wrote ${simplified.length} records to ${OUTPUT_PATH}`);
  } catch (err) {
    console.error('Failed to fetch/write goals data:', err.message);
    process.exit(1);
  }
})();
