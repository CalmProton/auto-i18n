# Batch Retry Endpoint

This endpoint allows you to create a new batch from failed requests in an error file, useful when you hit API quota limits or encounter other failures.

## Endpoint

```http
POST /batch/retry
```

## Request Body

```json
{
  "senderId": "string (required)",
  "originalBatchId": "string (required)",
  "errorFileName": "string (required)",
  "model": "string (optional)"
}
```

### Parameters

- **senderId**: The sender identifier (e.g., `"calmproton-pxguru-965169e"`)
- **originalBatchId**: The ID of the original batch that failed (e.g., `"batch_en_1760269403519_fa8a129e"`)
- **errorFileName**: The name of the error JSONL file (e.g., `"batch_68eb94cca7cc81909cb8ed2f1dd5facd_error.jsonl"`)
- **model**: (Optional) The OpenAI model to use for retry. If not specified, uses the default from config. Use this to switch to a different model to avoid quota limits (e.g., `"gpt-4.1-mini"`)

## Response

```json
{
  "message": "Retry batch created successfully",
  "batchId": "batch_en_1760269500000_12345678",
  "originalBatchId": "batch_en_1760269403519_fa8a129e",
  "requestCount": 123,
  "failedRequestCount": 123,
  "model": "gpt-4.1-mini",
  "manifest": {
    "batchId": "batch_en_1760269500000_12345678",
    "senderId": "calmproton-pxguru-965169e",
    "types": ["content", "global", "page"],
    "sourceLocale": "en",
    "targetLocales": ["ar", "bg", "cs", ...],
    "model": "gpt-4.1-mini",
    "totalRequests": 123,
    "status": "draft",
    "createdAt": "2025-10-12T...",
    "updatedAt": "2025-10-12T..."
  }
}
```

## How It Works

1. Reads the error JSONL file to extract failed request `custom_id`s
2. Finds matching requests from the original batch's `input.jsonl` file
3. Creates a new batch with only the failed requests
4. Optionally updates the model if specified
5. Saves the new batch input file and manifest

## Usage Example

### Step 1: Create the retry batch

```bash
curl -X POST http://localhost:3000/batch/retry \
  -H "Content-Type: application/json" \
  -d '{
    "senderId": "calmproton-pxguru-965169e",
    "originalBatchId": "batch_en_1760269403519_fa8a129e",
    "errorFileName": "batch_68eb94cca7cc81909cb8ed2f1dd5facd_error.jsonl",
    "model": "gpt-4.1-mini"
  }'
```

### Step 2: Submit the retry batch

Once you've created the retry batch, submit it to OpenAI:

```bash
curl -X POST http://localhost:3000/batch/{NEW_BATCH_ID}/submit \
  -H "Content-Type: application/json" \
  -d '{
    "senderId": "calmproton-pxguru-965169e"
  }'
```

## TypeScript/Bun Example

You can also use the example script:

```bash
# Create retry batch (doesn't submit)
bun run examples/retry-failed-batch.ts

# Create and submit retry batch
bun run examples/retry-failed-batch.ts --submit
```

## Common Use Cases

### 1. Quota Limit Errors

When you hit OpenAI's daily token quota:

```json
{
  "error": {
    "message": "You exceeded your current quota...",
    "type": "insufficient_quota",
    "code": "insufficient_quota"
  }
}
```

**Solution**: Create a retry batch with a different model (e.g., switch from `gpt-5-mini` to `gpt-4.1-mini`)

### 2. Rate Limit Errors

When you hit rate limits:

```json
{
  "error": {
    "message": "Rate limit exceeded...",
    "type": "rate_limit_exceeded"
  }
}
```

**Solution**: Create a retry batch and submit it after waiting for the rate limit to reset

### 3. Partial Batch Failures

When only some requests fail:

**Solution**: Create a retry batch to process only the failed requests, avoiding re-processing successful ones

## Error Handling

### Error File Not Found (404)

```json
{
  "error": "Error file batch_xxx_error.jsonl not found for batch batch_en_xxx"
}
```

**Fix**: Ensure the error file exists in the batch directory

### No Failed Requests (404)

```json
{
  "error": "No failed requests found in error file"
}
```

**Fix**: Check that the error file contains failed requests with `custom_id` fields

### Original Input Not Found (500)

```json
{
  "error": "Original input file not found for batch batch_en_xxx"
}
```

**Fix**: Ensure the original batch directory is intact with `input.jsonl`

## Notes

- The retry batch is created in **draft** status and needs to be submitted separately
- The new batch preserves the original `senderId`, `sourceLocale`, and `targetLocales`
- All request metadata (custom IDs, file records) is preserved from the original batch
- If you specify a `model`, it will be used for all requests in the retry batch
- The original batch files are not modified
