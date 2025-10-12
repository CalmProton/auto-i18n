# Testing Documentation

## Overview

This project has comprehensive test coverage for both frontend (Vue) and backend (Bun/Elysia) components.

## Test Stack

### Backend Tests
- **Framework**: Bun's built-in test runner
- **Location**: `tests/server/**/*.test.ts`
- **Coverage**: Middleware, utilities, routes, services

### Frontend Tests
- **Framework**: Vitest
- **Utils**: @vue/test-utils, @testing-library/vue
- **Environment**: happy-dom
- **Location**: `tests/client/**/*.test.ts`
- **Coverage**: Components, composables, utilities

## Running Tests

### Backend Tests (Bun)
```bash
# Run all backend tests
bun run test:backend

# Run specific test file
bun test tests/server/middleware/auth.test.ts

# Watch mode
bun test --watch
```

### Frontend Tests (Vitest)
```bash
# Run all frontend tests
bun run test:frontend

# Watch mode
bun run test:frontend:watch

# With coverage
bun run test:frontend:coverage
```

### All Tests
```bash
# Run both backend and frontend tests
bun run test:all

# Run tests with coverage
bun run test:coverage
```

## Test Structure

### Backend Tests

#### Middleware Tests
- `tests/server/middleware/auth.test.ts`
  - Authentication middleware functionality
  - Access key validation
  - Protected route handling

#### Utility Tests
- `tests/server/utils/fileValidation.test.ts`
  - File type validation
  - Request parsing
  - Locale/senderId extraction
  
- `tests/server/utils/fileStorage.test.ts`
  - File saving operations
  - Path resolution
  - Directory creation

- `tests/server/utils/logger.test.ts`
  - Logger creation and scoping
  - Log level functionality
  - Metadata handling

#### Configuration Tests
- `tests/server/config/locales.test.ts`
  - Supported locales validation
  - Locale format checking
  - Locale support detection

#### Route Tests
- `tests/server/routes/content.test.ts`
  - Content upload endpoints
  - Translation trigger endpoints
  - Authentication integration
  - Error handling

#### Service Tests
- `tests/batchOutputProcessor.test.ts`
  - Unicode escape decoding
  - Batch output parsing
  - Custom ID extraction

- `tests/openaiBatchService.test.ts`
  - Batch creation
  - JSONL payload generation
  - Manifest creation

### Frontend Tests

#### Composables
- `tests/client/composables/useAuth.test.ts`
  - Authentication state management
  - Login/logout functionality
  - Access key validation
  - Initialization logic

#### API Client
- `tests/client/lib/api-client.test.ts`
  - HTTP request methods (GET, POST, PUT, DELETE)
  - Access key header injection
  - Error handling
  - Response parsing

#### Components
- `tests/client/components/AuthGuard.test.ts`
  - Authentication guard logic
  - Protected content rendering
  - Login form functionality
  - Error display

## Test Patterns

### Backend Test Pattern
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'bun:test'

describe('Feature Name', () => {
  beforeEach(() => {
    // Setup
  })

  afterEach(() => {
    // Cleanup
  })

  it('should do something', () => {
    // Test implementation
    expect(result).toBe(expected)
  })
})
```

### Frontend Test Pattern
```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'

describe('Component Name', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render correctly', () => {
    const wrapper = mount(Component)
    expect(wrapper.text()).toContain('Expected Text')
  })
})
```

## Mocking

### Backend Mocking
- Use Bun's built-in module mocking when needed
- Create temporary directories for file system tests
- Mock environment variables for configuration tests

### Frontend Mocking
- Mock composables with `vi.mock()`
- Mock API calls with `vi.spyOn()`
- Use `vi.fn()` for function mocks

## Coverage

### Viewing Coverage Reports
```bash
# Backend coverage
bun run test:coverage

# Frontend coverage
bun run test:frontend:coverage
```

Coverage reports are generated in:
- Backend: Console output + coverage files
- Frontend: `coverage/` directory with HTML report

## Continuous Integration

Tests run automatically on:
- Pull requests
- Push to main branch
- Manual workflow dispatch

CI configuration: `.github/workflows/test.yml`

## Writing New Tests

### For Backend
1. Create test file in `tests/server/` matching the source file structure
2. Import from `bun:test`
3. Use temp directories for file operations
4. Clean up resources in `afterEach`

### For Frontend
1. Create test file in `tests/client/` matching the source file structure
2. Import from `vitest`
3. Mock external dependencies
4. Test user interactions and state changes

## Common Test Scenarios

### Testing File Uploads
```typescript
const file = new File(['content'], 'test.md', { type: 'text/markdown' })
const formData = new FormData()
formData.append('file', file)
```

### Testing API Responses
```typescript
vi.spyOn(api, 'get').mockResolvedValueOnce({ data: 'test' })
```

### Testing Component Events
```typescript
await wrapper.find('button').trigger('click')
expect(mockFn).toHaveBeenCalled()
```

### Testing Async Operations
```typescript
await wrapper.vm.$nextTick()
expect(wrapper.text()).toContain('Updated')
```

## Troubleshooting

### Backend Tests Failing
- Check environment variables are set correctly
- Ensure temp directories are cleaned up
- Verify file paths are absolute

### Frontend Tests Failing
- Clear mocks between tests
- Check if localStorage is properly mocked
- Verify async operations are awaited

### Coverage Issues
- Ensure test files have `.test.ts` extension
- Check include/exclude patterns in config
- Run tests in isolation to identify issues

## Best Practices

1. **Isolation**: Each test should be independent
2. **Cleanup**: Always clean up resources (files, env vars)
3. **Descriptive Names**: Use clear test descriptions
4. **Single Assertion**: Prefer one assertion per test when possible
5. **Mock External Dependencies**: Don't make real API calls or file operations outside temp dirs
6. **Test Edge Cases**: Include error scenarios and boundary conditions
7. **Keep Tests Fast**: Use mocks to avoid slow operations
8. **Maintain Coverage**: Aim for >80% coverage on critical paths
