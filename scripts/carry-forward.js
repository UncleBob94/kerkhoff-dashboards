// carry-forward.js
// Runs every Sunday night. Finds all goals marked Not Met for this week
// and creates a duplicate for the following week with Status = In Progress.
// Skips any goal that already has a carried-forward duplicate next week,
// so a re-run (manual retry, double-trigger, etc.) is safe.

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const DATABASE_ID  = '95e1f335-27b3-4c2f-80d0-86d8336f12d9';

if (!NOTION_TOKEN) {
  console.error('ERROR: NOTION_TOKEN environment variable is not set.');
  process.exit(1);
}

// Returns YYYY-MM-DD for a given Date object
function formatISO(d) {
  const y   = d.getFullYear();
  const m   = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Get this Sunday and next Sunday
function getThisAndNextSunday() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Find the most recent Sunday (today if today is Sunday)
  const dayOfWeek = today.getDay(); // 0 = Sunday
  const thisSunday = new Date(today);
  thisSunday.setDate(today.getDate() - dayOfWeek);

  const nextSunday = new Date(thisSunday);
  nextSunday.setDate(thisSunday.getDate() + 7);

  return { thisSunday, nextSunday };
}

async function notionRequest(endpoint, method = 'GET', body = null) {
  const url = `https://api.notion.com/v1/${endpoint}`;
  const options = {
    method,
    headers: {
      'Authorization': `Bearer ${NOTION_TOKEN}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json'
    }
  };
  if (body) options.body = JSON.stringify(body);

  const res = await fetch(url, options);
  if (!res.ok) {
    const err = await res.json();
    throw new Error(`Notion API error: ${err.message || res.status}`);
  }
  return res.json();
}

async function fetchGoalsForWeek(weekOfISO, statusFilter = null) {
  let goals = [], cursor;

  const filters = [{ property: 'Week Of', date: { equals: weekOfISO } }];
  if (statusFilter) {
    filters.push({ property: 'Status', select: { equals: statusFilter } });
  }

  do {
    const body = {
      page_size: 100,
      filter: { and: filters }
    };
    if (cursor) body.start_cursor = cursor;

    const data = await notionRequest(`databases/${DATABASE_ID}/query`, 'POST', body);
    goals  = goals.concat(data.results);
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);

  return goals;
}

function getGoalTitle(page) {
  return page.properties.Goal?.title?.[0]?.plain_text || '(untitled)';
}

async function createCarryForwardGoal(original, nextSundayISO) {
  const props = original.properties;

  const newProps = {
    Goal: {
      title: props.Goal?.title || []
    },
    Status: {
      select: { name: 'In Progress' }
    },
    'Week Of': {
      date: { start: nextSundayISO }
    }
  };

  if (props.Project?.relation?.length > 0) {
    newProps.Project = { relation: props.Project.relation };
  }

  if (props.Assignee?.people?.length > 0) {
    newProps.Assignee = { people: props.Assignee.people };
  }

  if (props.Priority?.select?.name) {
    newProps.Priority = { select: { name: props.Priority.select.name } };
  }

  await notionRequest('pages', 'POST', {
    parent: { database_id: DATABASE_ID },
    properties: newProps
  });
}

async function main() {
  const { thisSunday, nextSunday } = getThisAndNextSunday();
  const thisSundayISO = formatISO(thisSunday);
  const nextSundayISO = formatISO(nextSunday);

  console.log(`Running carry-forward for week of ${thisSundayISO}`);
  console.log(`Duplicating Not Met goals to week of ${nextSundayISO}`);

  const notMetGoals = await fetchGoalsForWeek(thisSundayISO, 'Not Met');
  console.log(`Found ${notMetGoals.length} Not Met goal(s) for this week`);

  if (notMetGoals.length === 0) {
    console.log('Nothing to carry forward. Done.');
    return;
  }

  // Guard against duplicate runs: pull whatever's already sitting in next
  // week's slot and skip any title that's already been carried forward.
  const existingNextWeek = await fetchGoalsForWeek(nextSundayISO);
  const existingTitles = new Set(existingNextWeek.map(getGoalTitle));

  let created = 0, skipped = 0;

  for (const goal of notMetGoals) {
    const title = getGoalTitle(goal);

    if (existingTitles.has(title)) {
      console.log(`  Skipping "${title}" — already carried forward to next week`);
      skipped++;
      continue;
    }

    console.log(`  Carrying forward: "${title}"`);
    await createCarryForwardGoal(goal, nextSundayISO);
    created++;
  }

  console.log(`Carry-forward complete. Created: ${created}, skipped (already existed): ${skipped}`);
}

main().catch(err => {
  console.error('Script failed:', err.message);
  process.exit(1);
});
