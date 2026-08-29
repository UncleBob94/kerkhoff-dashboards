// Runs server-side (GitHub Actions). Queries Notion for panels issued for
// construction and writes a small static JSON file the dashboard page reads.
// Requires NOTION_TOKEN as an environment variable (set via GitHub Secret) —
// never hardcode it here.

const DATABASE_ID = '3600a5e8-a4f0-80b9-bd21-e3ec01ecc187';
const YEAR = 2026;
const OUTPUT_PATH = 'panels-data.json';

const NOTION_TOKEN = process.env.NOTION_TOKEN;

if (!NOTION_TOKEN) {
  console.error('Missing NOTION_TOKEN environment variable.');
  process.exit(1);
}

async function fetchAllPages() {
  let results = [];
  let cursor;

  do {
    const body = {
      page_size: 100,
      filter: {
        and: [
          { property: 'Issued', checkbox: { equals: true } },
          { property: 'IFC Date', date: { on_or_after: `${YEAR}-01-01` } },
          { property: 'IFC Date', date: { on_or_before: `${YEAR}-12-31` } }
        ]
      }
    };
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
      const date = page.properties['IFC Date']?.date?.start || null;
      const panels = page.properties['No. of Panels']?.number || 0;
      return date ? { date, panels } : null;
    })
    .filter(Boolean);
}

(async () => {
  try {
    const pages = await fetchAllPages();
    const simplified = simplify(pages);

    const output = {
      generated_at: new Date().toISOString(),
      year: YEAR,
      records: simplified
    };

    const fs = await import('node:fs/promises');
    await fs.writeFile(OUTPUT_PATH, JSON.stringify(output, null, 2));
    console.log(`Wrote ${simplified.length} records to ${OUTPUT_PATH}`);
  } catch (err) {
    console.error('Failed to fetch/write panel data:', err.message);
    process.exit(1);
  }
})();
