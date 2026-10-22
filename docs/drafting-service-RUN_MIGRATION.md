# Database Migration Required

## Error
```
error: column "drive_item_id" of relation "drafts" does not exist
```

## Solution

You need to run the database migration to add the new columns. Run this SQL migration:

```bash
psql -d your_database_name -f Backend/drafting-service/db/migrations/003_add_sync_fields.sql
```

Or manually run the SQL in the migration file:

**File:** `Backend/drafting-service/db/migrations/003_add_sync_fields.sql`

## What the Migration Adds

The migration adds the following columns to the `drafts` table:

1. `editor_type` - Editor type (google, local, etc.)
2. `drive_item_id` - Google Drive item ID (same as google_file_id)
3. `drive_path` - Path in Google Drive
4. `last_opened_at` - Last time document was opened by user

## Alternative: Run Migration via psql

```bash
# Connect to your database
psql -U your_username -d your_database

# Then run:
\i Backend/drafting-service/db/migrations/003_add_sync_fields.sql
```

## Verify Migration

After running the migration, verify the columns exist:

```sql
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'drafts' 
ORDER BY ordinal_position;
```

You should see:
- `drive_item_id`
- `drive_path`
- `last_opened_at`
- `editor_type`

## Note

The code has been updated to be backward-compatible and will work with or without these columns, but for full functionality, please run the migration.


