# Database Migration Plan: File System to PostgreSQL + DragonflyDB

## Executive Summary

This document outlines the migration strategy from file-based storage (`tmp/` directory) to a hybrid database approach using **PostgreSQL** for persistent data and **DragonflyDB** (Redis-compatible) for caching and temporary data.

## Current File Structure Analysis

### Directory Structure
```
tmp/
└── {senderId}/
    ├── metadata.json              # Job metadata
    ├── uploads/
    │   └── {locale}/              # Source locale files
    │       ├── content/           # Markdown files
    │       ├── global/            # Global JSON translations
    │       └── page/              # Page-specific JSON translations
    ├── batches/
    │   └── {batchId}/
    │       ├── input.jsonl        # Batch input requests
    │       ├── manifest.json      # Batch metadata
    │       ├── {batch_id}_output.jsonl   # OpenAI output
    │       └── {batch_id}_error.jsonl    # OpenAI errors
    ├── changes/
    │   ├── metadata.json          # Changes workflow metadata
    │   ├── original/              # Original files from commit
    │   │   └── {locale}/
    │   └── ...
    ├── deltas/
    │   └── {locale}/              # Delta files (changes only)
    │       ├── content/
    │       ├── global/
    │       └── page/
    └── translations/
        └── {targetLocale}/        # Translated files
            ├── content/
            ├── global/
            └── page/

logs/
├── latest.log                     # Application logs
└── api-responses-*.json           # API response logs
```

### File Types and Sizes

| Data Type | Current Storage | Typical Size | Access Pattern |
|-----------|----------------|--------------|----------------|
| Session metadata | JSON files | 1-10 KB | Read/Write frequently |
| Upload files | File system | 1-100 KB each | Write once, read multiple times |
| Translation results | File system | 1-100 KB each | Write once, read multiple times |
| Delta files | File system | 1-50 KB each | Write once, read for processing |
| Batch manifests | JSON files | 5-50 KB | Read/Write frequently |
| Batch JSONL | JSONL files | 100 KB - 5 MB | Write once, read once |
| API responses | JSON files | 1-10 KB each | Write only (logging) |
| Application logs | Log files | Growing | Append only |

## Migration Strategy

### Phase 1: Database Schema Design ✅

**Status**: Complete

**Deliverables**:
- PostgreSQL schema with tables for sessions, jobs, files, batches, requests
- Indexes for performance optimization
- Views for common queries
- Triggers for automatic timestamp updates

**Key Tables**:
1. `sessions` - Replaces `tmp/{senderId}/metadata.json` and `tmp/{senderId}/changes/metadata.json`
2. `translation_jobs` - Replaces jobs array in metadata files
3. `files` - Replaces all file storage in `uploads/`, `translations/`, `deltas/`, `changes/original/`
4. `batches` - Replaces `tmp/{senderId}/batches/{batchId}/manifest.json`
5. `batch_requests` - Replaces lines in `input.jsonl` and tracks responses
6. `translation_stats` - Dashboard statistics cache

### Phase 2: Database Client Implementation

**Priority**: High

**Tasks**:
1. Add PostgreSQL client library
   ```bash
   bun add postgres
   # or
   bun add pg
   ```

2. Add Redis client for DragonflyDB
   ```bash
   bun add ioredis
   ```

3. Create database connection pool (`server/database/pool.ts`)
   ```typescript
   import postgres from 'postgres'
   
   export const sql = postgres(process.env.DATABASE_URL!, {
     max: 10,
     idle_timeout: 20,
     connect_timeout: 10,
   })
   ```

4. Create Redis client (`server/database/redis.ts`)
   ```typescript
   import Redis from 'ioredis'
   
   export const redis = new Redis(process.env.REDIS_URL!)
   ```

### Phase 3: Repository Layer

**Priority**: High

**Create repository classes to abstract database operations:**

1. **SessionRepository** (`server/repositories/sessionRepository.ts`)
   - `createSession(data)` - Create new session
   - `getSession(senderId)` - Get session by sender ID
   - `updateSession(senderId, updates)` - Update session
   - `deleteSession(senderId)` - Delete session
   - `listSessions(filters)` - List sessions with filtering

2. **FileRepository** (`server/repositories/fileRepository.ts`)
   - `saveFile(sessionId, fileData)` - Save file content
   - `getFile(sessionId, locale, path)` - Retrieve file
   - `getFilesBySession(sessionId, filters)` - List files
   - `deleteFile(fileId)` - Delete file
   - `updateFileContent(fileId, content)` - Update content

3. **BatchRepository** (`server/repositories/batchRepository.ts`)
   - `createBatch(batchData)` - Create batch
   - `getBatch(batchId)` - Get batch details
   - `updateBatchStatus(batchId, status)` - Update status
   - `saveBatchRequests(batchId, requests)` - Save requests
   - `updateBatchProgress(batchId, progress)` - Update progress

4. **JobRepository** (`server/repositories/jobRepository.ts`)
   - `createJob(sessionId, jobData)` - Create translation job
   - `getJob(jobId)` - Get job details
   - `updateJob(jobId, updates)` - Update job
   - `listJobs(sessionId)` - List jobs for session

### Phase 4: Utility Refactoring

**Priority**: High

**Refactor existing utilities to use repositories:**

| Current Utility | Target | Database Table | Cache Strategy |
|----------------|--------|----------------|----------------|
| `fileStorage.ts` | `fileRepository.ts` | `files` | None (direct DB) |
| `jobMetadata.ts` | `sessionRepository.ts` + `jobRepository.ts` | `sessions`, `translation_jobs` | Redis cache for active sessions |
| `batchStorage.ts` | `batchRepository.ts` | `batches`, `batch_requests` | Redis for JSONL processing |
| `changeStorage.ts` | `sessionRepository.ts` + `fileRepository.ts` | `sessions`, `files` | None |
| `dashboardUtils.ts` | Use repositories directly | All tables | Redis cache for stats |

### Phase 5: Cache Strategy (DragonflyDB)

**Priority**: Medium

**Use cases for Redis/DragonflyDB:**

1. **Session Cache** (TTL: 1 hour)
   ```
   Key: session:{senderId}
   Value: JSON serialized session data
   Purpose: Reduce DB queries for active sessions
   ```

2. **Batch Processing Queue**
   ```
   Key: batch:queue
   Type: List
   Purpose: Queue for batch processing tasks
   ```

3. **API Response Cache** (TTL: 5 minutes)
   ```
   Key: api:response:{hash}
   Value: Cached API response
   Purpose: Avoid duplicate API calls
   ```

4. **Translation Cache** (TTL: 24 hours)
   ```
   Key: translation:{hash}
   Value: Cached translation result
   Purpose: Avoid re-translating identical content
   ```

5. **Rate Limiting**
   ```
   Key: ratelimit:{provider}:{minute}
   Type: Counter with expiry
   Purpose: Track API rate limits
   ```

6. **Dashboard Stats Cache** (TTL: 30 seconds)
   ```
   Key: stats:dashboard
   Value: Cached statistics
   Purpose: Reduce DB load for dashboard
   ```

### Phase 6: Migration Script

**Priority**: Medium

**Create migration script to move existing data from files to database:**

`server/database/migrate.ts`:
```typescript
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { sql } from './pool'
import { createScopedLogger } from '../utils/logger'

const log = createScopedLogger('database:migrate')
const TMP_DIR = join(process.cwd(), 'tmp')

async function migrateSession(senderId: string) {
  // Read metadata.json or changes/metadata.json
  // Create session record
  // Migrate all files
  // Migrate batches
  // Create translation jobs
}

async function migrateAll() {
  const senderIds = readdirSync(TMP_DIR)
  for (const senderId of senderIds) {
    if (senderId === 'logs') continue
    await migrateSession(senderId)
  }
}
```

### Phase 7: Route Updates

**Priority**: High

**Update routes to use repositories instead of file utilities:**

Example for `routes/content.ts`:
```typescript
// Before
import { saveFile } from '../utils/fileStorage'
const savedFile = await saveFile(senderId, locale, 'content', file)

// After
import { fileRepository } from '../repositories/fileRepository'
const savedFile = await fileRepository.saveFile(sessionId, {
  fileType: 'upload',
  contentType: 'content',
  locale,
  relativePath: file.path,
  fileName: file.name,
  content: file.content,
  format: 'markdown'
})
```

### Phase 8: Testing Strategy

**Priority**: High

**Create tests for:**

1. Repository layer unit tests
2. Integration tests with test database
3. Migration script tests
4. Performance benchmarks (file vs DB)
5. Cache invalidation tests

Use Docker for test databases:
```yaml
# docker-compose.test.yml
services:
  test-postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: auto_i18n_test
  test-dragonfly:
    image: docker.dragonflydb.io/dragonflydb/dragonfly:latest
```

### Phase 9: Backwards Compatibility

**Priority**: Medium

**Implement feature flag for gradual migration:**

```typescript
// server/config/env.ts
export const USE_DATABASE = readEnv('USE_DATABASE') === 'true'

// server/utils/storage.ts
export const storage = USE_DATABASE 
  ? new DatabaseStorage() 
  : new FileStorage()
```

This allows running both systems in parallel during migration.

### Phase 10: Deployment & Rollout

**Priority**: Low (after testing)

**Steps:**
1. Deploy database containers
2. Run schema migration
3. Enable feature flag for 10% of requests
4. Monitor performance and errors
5. Gradually increase to 100%
6. Deprecate file-based storage
7. Clean up old code

## Data Retention & Cleanup

### Automatic Cleanup

1. **Expired Sessions**
   - Set `expires_at` on session creation (default: 30 days)
   - Daily cron job to delete expired sessions
   - Cascade deletes remove all related data

2. **Completed Batches**
   - Archive batch requests after 7 days
   - Keep manifest for statistics

3. **Cache Eviction**
   - DragonflyDB automatic eviction based on TTL
   - LRU eviction when memory limit reached

### Manual Cleanup

```sql
-- Delete sessions older than 90 days
DELETE FROM sessions WHERE created_at < NOW() - INTERVAL '90 days';

-- Delete completed batches older than 30 days
DELETE FROM batches 
WHERE status = 'completed' 
AND completed_at < NOW() - INTERVAL '30 days';
```

## Performance Considerations

### Indexing Strategy

All frequently queried columns have indexes:
- `sender_id`, `session_type`, `status` on `sessions`
- `batch_id`, `openai_batch_id` on `batches`
- `session_id`, `file_type`, `locale`, `relative_path` on `files`
- Full-text search on file content using `tsvector`

### Query Optimization

1. **Use prepared statements** to prevent SQL injection and improve performance
2. **Batch inserts** for multiple files (use `INSERT ... VALUES (...)` with multiple rows)
3. **Use views** for complex dashboard queries
4. **Materialized views** for expensive statistics (refresh hourly)

### Caching Strategy

- Cache frequently accessed sessions in Redis (1-hour TTL)
- Cache dashboard statistics (30-second TTL)
- Use Redis for rate limiting and job queues
- Implement cache-aside pattern for translations

## File Size Limits

### PostgreSQL
- Text fields: No practical limit (1 GB per field)
- JSONB fields: 1 GB
- Recommended: Store files < 10 MB in database

### Large File Handling
For files > 10 MB (rare in i18n):
1. Store in object storage (S3, MinIO)
2. Store URL/reference in database
3. Cache in DragonflyDB for quick access

## Backup Strategy

### PostgreSQL
```bash
# Daily backup
docker exec auto-i18n-postgres pg_dump -U auto_i18n auto_i18n > backup_$(date +%Y%m%d).sql

# Restore
docker exec -i auto-i18n-postgres psql -U auto_i18n auto_i18n < backup.sql
```

### DragonflyDB
- Enable snapshots for persistence
- No backup needed for cache-only data
- For persistent queues, use Redis RDB snapshots

## Environment Variables

Add to `.env`:
```bash
# Database
DATABASE_URL=postgresql://user:password@localhost:5432/auto_i18n
POSTGRES_MAX_CONNECTIONS=10

# Redis/DragonflyDB
REDIS_URL=redis://:password@localhost:6379
REDIS_MAX_RETRIES=3

# Feature flags
USE_DATABASE=true
ENABLE_CACHE=true

# Data retention
SESSION_EXPIRY_DAYS=30
BATCH_ARCHIVE_DAYS=7
```

## Migration Checklist

- [x] Design PostgreSQL schema
- [x] Create Docker Compose configuration
- [ ] Add database client libraries
- [ ] Implement connection pool
- [ ] Create repository layer
- [ ] Refactor file storage utilities
- [ ] Refactor batch storage utilities
- [ ] Refactor metadata utilities
- [ ] Update all routes
- [ ] Implement Redis caching
- [ ] Create migration script
- [ ] Write tests
- [ ] Performance benchmarking
- [ ] Documentation updates
- [ ] Deployment scripts
- [ ] Monitoring & logging
- [ ] Backup procedures

## Estimated Effort

| Phase | Effort | Priority |
|-------|--------|----------|
| Schema Design | 1 day | ✅ Complete |
| Client Setup | 0.5 days | High |
| Repository Layer | 3 days | High |
| Utility Refactoring | 4 days | High |
| Cache Implementation | 2 days | Medium |
| Migration Script | 2 days | Medium |
| Route Updates | 3 days | High |
| Testing | 3 days | High |
| Documentation | 1 day | Medium |
| Deployment | 1 day | Low |

**Total**: ~20 days

## Benefits

1. **Scalability**: Database handles concurrent access better than file system
2. **Performance**: Indexed queries faster than file scans
3. **Reliability**: ACID transactions prevent data corruption
4. **Features**: Complex queries, aggregations, full-text search
5. **Backup**: Standard database backup tools
6. **Monitoring**: Database metrics and query performance
7. **Multi-instance**: Multiple app instances can share database
8. **Type Safety**: Schema enforcement at database level

## Risks & Mitigation

| Risk | Impact | Mitigation |
|------|--------|------------|
| Data loss during migration | High | Test migration script, keep backups |
| Performance regression | Medium | Benchmark before/after, optimize queries |
| Breaking changes | High | Feature flag, gradual rollout |
| Database downtime | Medium | Use connection pooling, implement retries |
| Storage costs | Low | Implement retention policies |

## Next Steps

1. **Immediate**: Review and approve schema design
2. **Week 1**: Implement repository layer and database clients
3. **Week 2**: Refactor utilities and update routes
4. **Week 3**: Implement caching and migration script
5. **Week 4**: Testing and performance optimization
6. **Week 5**: Deployment and monitoring

## Questions & Decisions

1. **File size limit**: Keep 10 MB limit or allow larger?
   - **Recommendation**: 10 MB should be sufficient for i18n files

2. **Cache vs Database**: Which data should be cached?
   - **Recommendation**: Cache active sessions and stats only

3. **Migration timing**: Big bang or gradual?
   - **Recommendation**: Feature flag with gradual rollout

4. **Old data**: Migrate all or start fresh?
   - **Recommendation**: Provide migration script but optional

5. **Logs**: Keep in files or move to database?
   - **Recommendation**: Keep logs in files, use external logging service for production
