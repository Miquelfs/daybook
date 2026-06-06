# Daybook: Custom Tags & Correlation System
## Complete Implementation Guide

---

## Overview

You're building a **self-knowledge engine** with three layers:

1. **Tags** - Flexible categorization ("cycled", "good mood", "traveling")
2. **Correlations** - Statistical relationships ("Does cycled correlate with mood?")
3. **Discovery** - Find patterns ("Show me weekends I cycled AND felt good")

Inspired by:
- **exist.io** custom tags for subjective day categorization
- **changemap.co** correlation visualization for finding patterns in personal data

---

## Architecture Overview

```
Frontend (Next.js/React)
  ↓
  ├─ TagManager component (add/remove tags)
  ├─ CorrelationViewer (explore relationships)
  └─ TagSearch (AND/OR tag queries)
  ↓
FastAPI Backend (/api/v1/...)
  ├─ POST /tags
  ├─ GET /correlations
  ├─ GET /search/tags
  └─ CRUD for day tags
  ↓
SQLite Database
  ├─ tags (global registry)
  ├─ day_tags (many-to-many)
  ├─ tag_correlations (pre-computed)
  └─ tag_cooccurrence (which tags appear together)
  ↓
Correlation Engine (nightly cron)
  └─ Computes Pearson r, p-values, effect sizes
```

---

## Step 1: Update Database Schema

### On Raspberry Pi:

```bash
ssh pi@daybook-pi.local
cd ~/daybook/data/sqlite

# Backup existing database
sqlite3 daybook.db ".backup daybook-backup-$(date +%Y%m%d).db"

# Add tag tables to schema
sqlite3 daybook.db < /path/to/daybook_tags_schema.sql

# Verify tables created
sqlite3 daybook.db ".tables"
# Should include: tags, day_tags, tag_correlations, tag_cooccurrence
```

Or directly copy the schema SQL:
1. Download the file `daybook_tags_schema.sql` from `/home/claude/`
2. Copy to Pi: `scp daybook_tags_schema.sql pi@daybook-pi.local:~/daybook/data/sqlite/`
3. Run: `sqlite3 ~/daybook/data/sqlite/daybook.db < daybook_tags_schema.sql`

### Verify:
```bash
sqlite3 ~/daybook/data/sqlite/daybook.db
sqlite> SELECT COUNT(*) FROM tags;  # Should be ~23 (pre-seeded tags)
sqlite> .quit
```

---

## Step 2: Integrate API Endpoints

### Edit `~/daybook/infrastructure/api/main.py`:

1. Copy the contents of `daybook_tags_api.py` into your FastAPI app
2. Or integrate selectively:

```python
from fastapi import FastAPI, HTTPException, Query, APIRouter
from pydantic import BaseModel
from datetime import date
from typing import List, Optional
import sqlite3

# ... existing imports ...

# Add router
router = APIRouter(prefix="/api/v1", tags=["tags"])

# Import functions from daybook_tags_api.py
from .tags_module import (
    create_tag, get_all_tags, get_tag, delete_tag,
    add_tag_to_day, remove_tag_from_day, get_day_tags,
    get_correlations, search_by_tags,
    TagCreate, TagResponse, DayWithTagsResponse, CorrelationResponse
)

# Routes
@router.post("/tags", response_model=TagResponse)
async def create_new_tag(tag: TagCreate):
    return create_tag(tag)

@router.get("/tags", response_model=List[TagResponse])
async def list_all_tags():
    return get_all_tags()

@router.get("/tags/{tag_slug}", response_model=TagResponse)
async def get_tag_details(tag_slug: str):
    return get_tag(tag_slug)

@router.delete("/tags/{tag_slug}")
async def delete_tag_endpoint(tag_slug: str):
    return delete_tag(tag_slug)

@router.post("/day/{day}/tags")
async def add_tag(day: date, tag_slug: str, note: Optional[str] = None):
    return add_tag_to_day(day, tag_slug, note)

@router.delete("/day/{day}/tags/{tag_slug}")
async def remove_tag(day: date, tag_slug: str):
    return remove_tag_from_day(day, tag_slug)

@router.get("/day/{day}/tags", response_model=DayWithTagsResponse)
async def get_tags_for_day(day: date):
    return get_day_tags(day)

@router.get("/correlations", response_model=List[CorrelationResponse])
async def list_correlations(tag_slug: Optional[str] = None):
    return get_correlations(tag_slug)

@router.get("/search/tags", response_model=List[DayWithTagsResponse])
async def search_tags(
    tags: Optional[List[str]] = Query(None),
    any_tags: Optional[List[str]] = Query(None),
    exclude_tags: Optional[List[str]] = Query(None),
    start_date: Optional[str] = None,
    end_date: Optional[str] = None
):
    return search_by_tags(tags, any_tags, exclude_tags, start_date, end_date)

app.include_router(router)
```

### Test the endpoints:

```bash
# List tags
curl http://localhost:8000/api/v1/tags

# Get tag details
curl http://localhost:8000/api/v1/tags/cycled

# Add tag to today
curl -X POST http://localhost:8000/api/v1/day/2026-05-21/tags \
  -H "Content-Type: application/json" \
  -d '{"tag_slug": "cycled", "note": "90-minute road ride"}'

# Get all tags for a day
curl http://localhost:8000/api/v1/day/2026-05-21/tags

# Search for days (AND logic)
curl "http://localhost:8000/api/v1/search/tags?tags=cycled&tags=good_mood"

# Get correlations for one tag
curl http://localhost:8000/api/v1/correlations?tag_slug=cycled
```

---

## Step 3: Set Up Correlation Engine

### Create the cron job:

1. Copy `daybook_correlation_engine.py` to Pi:
```bash
scp daybook_correlation_engine.py pi@daybook-pi.local:~/daybook/scripts/
chmod +x ~/daybook/scripts/daybook_correlation_engine.py
```

2. Test it manually first:
```bash
ssh pi@daybook-pi.local
cd ~/daybook/scripts
python3 daybook_correlation_engine.py
# Check logs:
tail -f ~/daybook/logs/correlation-engine.log
```

3. Add to crontab (runs nightly at 2 AM):
```bash
crontab -e
# Add:
0 2 * * * /usr/bin/python3 /home/pi/daybook/scripts/daybook_correlation_engine.py
```

4. Verify cron entry:
```bash
crontab -l
```

---

## Step 4: Integrate React Components

### Place the React component in your Next.js app:

1. Copy `TagManager.tsx` to:
   ```
   ~/daybook/infrastructure/web/components/TagManager.tsx
   ```

2. Use in your Day view:
```tsx
// pages/day/[date].tsx
import TagManager, { CorrelationViewer, TagSearch } from '@/components/TagManager';

export default function DayView({ date }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      {/* Main day content */}
      <div className="lg:col-span-2">
        {/* ... existing day data ... */}
      </div>

      {/* Sidebar */}
      <div className="space-y-6">
        {/* Tags */}
        <TagManager selectedDate={date} />

        {/* Correlations (read-only, exploratory) */}
        <CorrelationViewer />

        {/* Advanced search */}
        <TagSearch />
      </div>
    </div>
  );
}
```

3. Use in your Today view:
```tsx
// pages/today.tsx
import TagManager from '@/components/TagManager';
import { CorrelationViewer, TagSearch } from '@/components/TagManager';
```

---

## Step 5: Initialize & Test

### 1. Populate tags with data:

```bash
# On Pi
sqlite3 ~/daybook/data/sqlite/daybook.db

# Tag some past days (examples)
INSERT INTO day_tags (date, tag_id) 
SELECT '2026-05-21', id FROM tags WHERE slug = 'cycled';

INSERT INTO day_tags (date, tag_id)
SELECT '2026-05-21', id FROM tags WHERE slug = 'good_mood';

INSERT INTO day_tags (date, tag_id)
SELECT '2026-05-20', id FROM tags WHERE slug = 'cycled';

-- Run the correlation engine
.quit
```

### 2. Run correlation engine:

```bash
python3 ~/daybook/scripts/daybook_correlation_engine.py
```

### 3. Query correlations:

```bash
sqlite3 ~/daybook/data/sqlite/daybook.db
SELECT * FROM tag_correlations WHERE tag_id = (SELECT id FROM tags WHERE slug = 'cycled');
.quit
```

### 4. Test API endpoints:

```bash
# From your Mac/iPhone via Tailscale
curl http://daybook-pi:8000/api/v1/tags
curl http://daybook-pi:8000/api/v1/correlations?tag_slug=cycled
```

### 5. Test React UI:

- Open Today view in your Next.js app
- Try adding a tag
- Look at correlations section
- Search for days with tag combinations

---

## Workflow: How to Use It Daily

### Evening Ritual (5 minutes):

1. **Open Daybook** on iPhone via Tailscale
2. **Fill out questionnaire** (energy, mood, stress)
3. **Add tags** for the day:
   - What did I do? ("cycled", "deep_work", "socializing")
   - How did I feel? ("great_mood", "stressed", "recovered")
   - Where was I? ("traveling", "back_home", "timezone_change")
4. **Save**

### Weekly (10 minutes):

1. Go to **Correlations** tab
2. Select a tag you're curious about
3. See what metrics correlate with it
4. Notice patterns: "When I cycle, my mood is higher. When I fly, my sleep drops."
5. Find **unexpected correlations**: "I didn't know that."

### Monthly:

Run the correlation engine manually to refresh:
```bash
python3 ~/daybook/scripts/daybook_correlation_engine.py
```

Or let the nightly cron job handle it.

---

## Example Queries: What You Can Ask

### Simple searches:
- "Show me all days I cycled"
  ```
  GET /api/v1/search/tags?tags=cycled
  ```

- "Show me days I cycled OR ran"
  ```
  GET /api/v1/search/tags?any_tags=cycled&any_tags=running
  ```

- "Days I felt great AND cycled"
  ```
  GET /api/v1/search/tags?tags=great_mood&tags=cycled
  ```

- "Days I cycled but NOT stressed"
  ```
  GET /api/v1/search/tags?tags=cycled&exclude_tags=stressed
  ```

### Correlations:
- "Does cycling correlate with sleep?"
  ```
  GET /api/v1/correlations?tag_slug=cycled
  # Look for correlation_coefficient on sleep_quality
  ```

- "Which tags predict high mood?"
  ```
  GET /api/v1/correlations
  # Filter for metric_name = "mood", direction = "positive", high r values
  ```

---

## Schema Reference

### `tags`
```sql
id              -- Auto-generated
name            -- "cycled", "deep_work"
slug            -- "cycled", "deep_work" (URL-safe)
category        -- "activity", "work", "health", "emotion", etc.
icon            -- "🚴", "🔥", "😄" (for UI badges)
description     -- "Did a cycling workout"
color           -- Optional hex color for styling
```

### `day_tags`
```sql
date            -- Foreign key to days table
tag_id          -- Which tag
note            -- Optional context ("3-hour ride", "felt amazing")
created_at      -- When the tag was added
```

### `tag_correlations` (pre-computed nightly)
```sql
tag_id          -- Which tag
metric_name     -- "mood", "sleep_quality", "steps", etc.
correlation_coefficient  -- Pearson r (-1.0 to 1.0)
p_value         -- Statistical significance (< 0.05 is good)
sample_count    -- How many days had both tag and metric
effect_size     -- "small", "medium", "large"
direction       -- "positive", "negative", "neutral"
computed_at     -- When this was calculated
```

### `tag_cooccurrence` (pre-computed nightly)
```sql
tag_id_1        -- First tag
tag_id_2        -- Second tag
co_occurrence_count  -- How many days had both?
co_occurrence_pct    -- % of days with tag_1 that also had tag_2
computed_at     -- When this was calculated
```

---

## Performance Notes

### Database Indexes
All common queries are indexed:
- `day_tags.date` for "get all tags for a day"
- `day_tags.tag_id` for "get all days with a tag"
- `tag_correlations.tag_id` for "get correlations for a tag"

### Correlation Engine Performance
- Runs nightly in ~2-5 minutes (depending on data size)
- Only computes significant correlations (p < 0.05 or |r| > 0.3)
- Requires minimum 5 samples per tag-metric pair

### Frontend Optimization
- TagManager autocomplete is client-side filtered
- CorrelationViewer only loads data for selected tag
- Use `max_results` parameter in API for pagination

---

## Customization: Your Tags

The schema comes with ~23 pre-seeded tags. Customize for your life:

```sql
-- Add a custom tag
INSERT INTO tags (name, slug, category, icon, description)
VALUES ('meditation', 'meditation', 'health', '🧘', 'Daily meditation practice');

-- Query your tags
SELECT name, slug, category, icon, (SELECT COUNT(*) FROM day_tags WHERE tag_id = tags.id) as count
FROM tags
ORDER BY count DESC;
```

### Tag Categories (Suggested)
- **activity**: cycled, running, swimming, hiking, flying, yoga
- **social**: socializing, alone_time, family_time, dating
- **work**: deep_work, deadline, learning, stuck, meeting
- **health**: good_sleep, poor_sleep, sick, injured, recovered, stressed, anxious
- **location**: traveling, layover, timezone_change, back_home
- **emotion**: great_mood, low_mood, energetic, tired
- **environment**: good_weather, bad_weather, outdoors

---

## Troubleshooting

### No correlations computed?
- Check that you have **at least 5 days** with a tag
- Check that those days also have the metric (e.g., mood value)
- Run correlation engine: `python3 ~/daybook/scripts/daybook_correlation_engine.py`
- Check logs: `tail -f ~/daybook/logs/correlation-engine.log`

### API returns 404 for tag?
- Tag slug might be wrong. Get it from: `GET /api/v1/tags`
- Slugs are lowercase with underscores: "deep_work", not "Deep Work"

### Tags not showing in UI?
- Did you run the schema SQL? Check: `sqlite3 daybook.db ".tables"` should show `tags`
- Check browser console for API errors
- Verify API is running: `curl http://localhost:8000/api/v1/tags`

### Correlation engine takes too long?
- Reduce `days_lookback` parameter in `compute_tag_correlations()` (default 90)
- Or run it during off-peak hours (adjust cron)

---

## Next Steps

### Phase 3 features that build on this:
1. **Tag streaks**: "You've cycled 7 days in a row"
2. **Tag-based budgets**: Filter expenses by tag
3. **Co-occurrence visualizations**: "Tags that appear together"
4. **Weekly summaries**: "This week you cycled 3x, mood was up"
5. **Custom LLM queries**: "Show me weekends I felt great AND cycled" (natural language)

### Long-term evolution:
- Move from "past-looking" (correlations) to "predictive" (does X predict tomorrow's mood?)
- Add **causal** analysis, not just correlation
- Build a **decision log** with tags + outcomes
- Create **habits engine**: streaks, triggers, improvements

---

## References

- **exist.io custom tags**: https://exist.io/about/custom-tags/
- **changemap.co correlations**: https://changemap.co/
- **Pearson correlation coefficient**: https://en.wikipedia.org/wiki/Pearson_correlation_coefficient
- **Statistical significance (p-values)**: https://en.wikipedia.org/wiki/P-value
- **Cohen's d effect size**: https://en.wikipedia.org/wiki/Effect_size#Cohen's_d

---

**Last Updated:** May 21, 2026
**Status:** Ready to implement
