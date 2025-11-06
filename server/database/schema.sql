-- Auto-i18n Database Schema
-- PostgreSQL 16+

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm"; -- For text search optimization

-- ============================================================================
-- SESSIONS
-- Represents an upload or translation session (previously stored in tmp/<senderId>/)
-- ============================================================================
CREATE TABLE sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    sender_id VARCHAR(255) UNIQUE NOT NULL, -- Original senderId from file system
    session_type VARCHAR(50) NOT NULL CHECK (session_type IN ('upload', 'changes')),
    status VARCHAR(50) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'processing', 'completed', 'failed', 'submitted')),
    
    -- Repository information (for changes workflow)
    repository_owner VARCHAR(255),
    repository_name VARCHAR(255),
    base_branch VARCHAR(255),
    base_commit_sha VARCHAR(40),
    commit_sha VARCHAR(40),
    commit_message TEXT,
    commit_author VARCHAR(255),
    commit_timestamp TIMESTAMPTZ,
    
    -- Locale information
    source_locale VARCHAR(10) NOT NULL,
    target_locales TEXT[], -- Array of target locale codes
    
    -- Metadata
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ, -- Optional expiration for cleanup
    
    -- Additional metadata (flexible JSONB for custom fields)
    metadata JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX idx_sessions_sender_id ON sessions(sender_id);
CREATE INDEX idx_sessions_status ON sessions(status);
CREATE INDEX idx_sessions_type ON sessions(session_type);
CREATE INDEX idx_sessions_created_at ON sessions(created_at);
CREATE INDEX idx_sessions_repository ON sessions(repository_owner, repository_name) WHERE repository_owner IS NOT NULL;
CREATE INDEX idx_sessions_metadata ON sessions USING GIN(metadata);

-- ============================================================================
-- TRANSLATION_JOBS
-- Individual translation jobs within a session (previously in metadata.json)
-- ============================================================================
CREATE TABLE translation_jobs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    job_id VARCHAR(255) NOT NULL, -- Original job.id from metadata
    job_type VARCHAR(50) CHECK (job_type IN ('content', 'global', 'page')),
    
    -- Translation details
    source_locale VARCHAR(10) NOT NULL,
    target_locales TEXT[],
    
    -- GitHub integration
    github_issue_number INTEGER,
    github_issue_url TEXT,
    github_pr_number INTEGER,
    github_pr_url TEXT,
    github_branch VARCHAR(255),
    
    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    UNIQUE(session_id, job_id)
);

CREATE INDEX idx_translation_jobs_session ON translation_jobs(session_id);
CREATE INDEX idx_translation_jobs_job_id ON translation_jobs(job_id);
CREATE INDEX idx_translation_jobs_pr ON translation_jobs(github_pr_number) WHERE github_pr_number IS NOT NULL;

-- ============================================================================
-- FILES
-- Represents uploaded files, translations, and deltas
-- Replaces: tmp/<senderId>/uploads/, tmp/<senderId>/translations/, tmp/<senderId>/deltas/
-- ============================================================================
CREATE TABLE files (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    job_id UUID REFERENCES translation_jobs(id) ON DELETE CASCADE,
    
    -- File classification
    file_type VARCHAR(50) NOT NULL CHECK (file_type IN ('upload', 'translation', 'delta', 'original')),
    content_type VARCHAR(50) NOT NULL CHECK (content_type IN ('content', 'global', 'page')),
    format VARCHAR(20) NOT NULL CHECK (format IN ('markdown', 'json')),
    
    -- File location/identification
    locale VARCHAR(10) NOT NULL,
    relative_path TEXT NOT NULL, -- e.g., "tools/image/upscale.md" or "en.json"
    file_name VARCHAR(255) NOT NULL,
    
    -- File content (stored directly in database)
    content TEXT NOT NULL,
    content_hash VARCHAR(64), -- SHA-256 hash for deduplication and change detection
    file_size INTEGER,
    
    -- Metadata
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Additional file metadata (frontmatter, custom fields, etc.)
    metadata JSONB DEFAULT '{}'::jsonb,
    
    UNIQUE(session_id, file_type, locale, relative_path)
);

CREATE INDEX idx_files_session ON files(session_id);
CREATE INDEX idx_files_job ON files(job_id) WHERE job_id IS NOT NULL;
CREATE INDEX idx_files_type ON files(file_type);
CREATE INDEX idx_files_content_type ON files(content_type);
CREATE INDEX idx_files_locale ON files(locale);
CREATE INDEX idx_files_path ON files(relative_path);
CREATE INDEX idx_files_hash ON files(content_hash) WHERE content_hash IS NOT NULL;
CREATE INDEX idx_files_metadata ON files USING GIN(metadata);
-- Full-text search on content (useful for searching translations)
CREATE INDEX idx_files_content_search ON files USING GIN(to_tsvector('english', content));

-- ============================================================================
-- BATCHES
-- OpenAI batch translation jobs
-- Replaces: tmp/<senderId>/batches/<batchId>/
-- ============================================================================
CREATE TABLE batches (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    batch_id VARCHAR(255) UNIQUE NOT NULL, -- Original batchId
    session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    
    -- Batch configuration
    source_locale VARCHAR(10) NOT NULL,
    target_locales TEXT[],
    content_types TEXT[], -- ['global', 'page', 'content']
    model VARCHAR(100) NOT NULL,
    
    -- OpenAI Batch API details
    openai_batch_id VARCHAR(255), -- ID from OpenAI Batch API
    openai_status VARCHAR(50), -- validating, failed, in_progress, finalizing, completed, expired, cancelling, cancelled
    
    -- Progress tracking
    total_requests INTEGER NOT NULL DEFAULT 0,
    completed_requests INTEGER DEFAULT 0,
    failed_requests INTEGER DEFAULT 0,
    
    -- Status
    status VARCHAR(50) NOT NULL DEFAULT 'created' CHECK (status IN ('created', 'submitted', 'processing', 'completed', 'failed', 'cancelled')),
    
    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    submitted_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    
    -- Error tracking
    error_message TEXT,
    
    -- Manifest data (original manifest.json)
    manifest JSONB NOT NULL
);

CREATE INDEX idx_batches_batch_id ON batches(batch_id);
CREATE INDEX idx_batches_session ON batches(session_id);
CREATE INDEX idx_batches_status ON batches(status);
CREATE INDEX idx_batches_openai_batch_id ON batches(openai_batch_id) WHERE openai_batch_id IS NOT NULL;
CREATE INDEX idx_batches_created_at ON batches(created_at);
CREATE INDEX idx_batches_manifest ON batches USING GIN(manifest);

-- ============================================================================
-- BATCH_REQUESTS
-- Individual translation requests within a batch
-- Replaces: Lines in input.jsonl files
-- ============================================================================
CREATE TABLE batch_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    batch_id UUID NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
    
    -- Request identification
    custom_id VARCHAR(255) NOT NULL, -- From JSONL custom_id field
    request_index INTEGER NOT NULL, -- Line number in original JSONL
    
    -- File reference
    file_id UUID REFERENCES files(id) ON DELETE SET NULL,
    relative_path TEXT NOT NULL,
    target_locale VARCHAR(10) NOT NULL,
    
    -- Request details
    request_body JSONB NOT NULL, -- Original OpenAI API request
    
    -- Response details
    response_body JSONB, -- OpenAI API response
    response_status INTEGER, -- HTTP status code
    
    -- Status
    status VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed')),
    error_message TEXT,
    
    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    UNIQUE(batch_id, custom_id)
);

CREATE INDEX idx_batch_requests_batch ON batch_requests(batch_id);
CREATE INDEX idx_batch_requests_file ON batch_requests(file_id) WHERE file_id IS NOT NULL;
CREATE INDEX idx_batch_requests_status ON batch_requests(status);
CREATE INDEX idx_batch_requests_locale ON batch_requests(target_locale);
CREATE INDEX idx_batch_requests_custom_id ON batch_requests(custom_id);

-- ============================================================================
-- TRANSLATION_STATS
-- Statistics for dashboard and monitoring
-- ============================================================================
CREATE TABLE translation_stats (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    
    -- Counts by type
    uploads_count INTEGER DEFAULT 0,
    translations_count INTEGER DEFAULT 0,
    
    -- Counts by content type
    content_files INTEGER DEFAULT 0,
    global_files INTEGER DEFAULT 0,
    page_files INTEGER DEFAULT 0,
    
    -- Locale coverage
    source_locale VARCHAR(10),
    target_locales_count INTEGER DEFAULT 0,
    completed_locales TEXT[],
    
    -- Batch statistics
    batches_count INTEGER DEFAULT 0,
    active_batches INTEGER DEFAULT 0,
    completed_batches INTEGER DEFAULT 0,
    
    -- Timestamps
    calculated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Additional stats
    stats JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX idx_translation_stats_session ON translation_stats(session_id);
CREATE INDEX idx_translation_stats_calculated ON translation_stats(calculated_at);

-- ============================================================================
-- TRIGGERS
-- Auto-update timestamps
-- ============================================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_sessions_updated_at BEFORE UPDATE ON sessions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_translation_jobs_updated_at BEFORE UPDATE ON translation_jobs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_files_updated_at BEFORE UPDATE ON files
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_batches_updated_at BEFORE UPDATE ON batches
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_batch_requests_updated_at BEFORE UPDATE ON batch_requests
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- VIEWS
-- Convenient views for common queries
-- ============================================================================

-- Session overview with file counts
CREATE VIEW v_session_overview AS
SELECT 
    s.id,
    s.sender_id,
    s.session_type,
    s.status,
    s.source_locale,
    s.target_locales,
    s.created_at,
    s.updated_at,
    COUNT(DISTINCT f.id) FILTER (WHERE f.file_type = 'upload') as upload_count,
    COUNT(DISTINCT f.id) FILTER (WHERE f.file_type = 'translation') as translation_count,
    COUNT(DISTINCT b.id) as batch_count,
    COUNT(DISTINCT tj.id) as job_count
FROM sessions s
LEFT JOIN files f ON s.id = f.session_id
LEFT JOIN batches b ON s.id = b.session_id
LEFT JOIN translation_jobs tj ON s.id = tj.session_id
GROUP BY s.id;

-- Batch progress view
CREATE VIEW v_batch_progress AS
SELECT 
    b.id,
    b.batch_id,
    b.session_id,
    b.status,
    b.openai_status,
    b.total_requests,
    b.completed_requests,
    b.failed_requests,
    CASE 
        WHEN b.total_requests > 0 
        THEN ROUND((b.completed_requests::numeric / b.total_requests * 100), 2)
        ELSE 0
    END as progress_percentage,
    b.created_at,
    b.submitted_at,
    b.completed_at
FROM batches b;

-- Translation progress matrix (similar to dashboard)
CREATE VIEW v_translation_matrix AS
SELECT 
    s.id as session_id,
    s.sender_id,
    f.locale,
    f.content_type,
    COUNT(*) as file_count,
    SUM(f.file_size) as total_size,
    MAX(f.updated_at) as last_updated
FROM sessions s
JOIN files f ON s.id = f.session_id
WHERE f.file_type IN ('upload', 'translation')
GROUP BY s.id, s.sender_id, f.locale, f.content_type;

-- ============================================================================
-- CLEANUP FUNCTION
-- Automatically clean up expired sessions
-- ============================================================================
CREATE OR REPLACE FUNCTION cleanup_expired_sessions()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM sessions 
    WHERE expires_at IS NOT NULL 
    AND expires_at < NOW();
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Optional: Create a scheduled job using pg_cron extension
-- COMMENT: Uncomment below if pg_cron extension is available
-- SELECT cron.schedule('cleanup-expired-sessions', '0 2 * * *', 'SELECT cleanup_expired_sessions();');
